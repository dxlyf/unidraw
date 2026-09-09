/**
 * UniformBlock —— 一个绑定到管线 bind group 的 UBO 便捷封装。
 *
 * 职责：
 * - 按 std140 布局在 CPU 侧打包 uniform 数据（Vec3/Color/Mat4/数组）；
 * - flush() 一次性写入设备 Buffer；
 * - 避免框架用户手动接触字节偏移。
 */

import type { Device } from "../device/Device.js";
import { type Buffer } from "../device/resources.js";
import { assert } from "../util/assert.js";
import type { Mat4 } from "../math/mat4.js";
import { type Color } from "../math/color.js";
import { std140Layout, type Std140Layout, type UniformField } from "../gpu/std140.js";
import { BufferUsage } from "../gpu/types.js";

export interface UniformBlockOptions {
  label?: string;
  /** 通常从 Material/管线布局复用 */
  fields: UniformField[];
  /** 每帧重写时建议传入 */
  dynamic?: boolean;
}

export class UniformBlock {
  readonly device: Device;
  readonly layout: Std140Layout;
  readonly buffer: Buffer;
  readonly label: string | undefined;
  private readonly _f32: Float32Array;
  private readonly _bytes: ArrayBuffer;

  constructor(device: Device, options: UniformBlockOptions) {
    this.device = device;
    this.label = options.label;
    this.layout = std140Layout(options.fields);
    this._bytes = new ArrayBuffer(this.layout.size);
    this._f32 = new Float32Array(this._bytes);
    this.buffer = device.createBuffer({
      label: options.label ? `${options.label}-ubo` : undefined,
      size: this.layout.size,
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
    });
  }

  /** 字段是否声明 */
  has(name: string): boolean {
    return this.layout.byName.has(name);
  }

  private field(name: string) {
    const f = this.layout.byName.get(name);
    assert(f, `uniform 字段 "${name}" 未在布局中声明`);
    return f;
  }

  private indexOffset(name: string, element: number): number {
    const f = this.field(name);
    return f.offset + (f.count > 1 ? element * f.stride : 0);
  }

  setFloat(name: string, value: number): void {
    const f = this.field(name);
    assert(f.type === "f32" || f.type === "i32" || f.type === "u32", `字段 ${name} 不是标量`);
    this._f32[f.offset / 4] = value;
  }

  setVec2(name: string, x: number, y: number): void {
    const f = this.field(name);
    assert(f.type === "vec2", `字段 ${name} 不是 vec2`);
    const i = f.offset / 4;
    this._f32[i] = x;
    this._f32[i + 1] = y;
  }

  setVec3(name: string, x: number, y: number, z: number): void {
    const f = this.field(name);
    assert(f.type === "vec3", `字段 ${name} 不是 vec3`);
    const i = f.offset / 4;
    this._f32[i] = x;
    this._f32[i + 1] = y;
    this._f32[i + 2] = z;
  }

  setVec4(name: string, x: number, y: number, z: number, w: number): void {
    const f = this.field(name);
    assert(f.type === "vec4", `字段 ${name} 不是 vec4`);
    const i = f.offset / 4;
    this._f32[i] = x;
    this._f32[i + 1] = y;
    this._f32[i + 2] = z;
    this._f32[i + 3] = w;
  }

  setColor(name: string, color: Color): void {
    this.setVec4(name, color.x, color.y, color.z, color.w);
  }

  setMat4(name: string, matrix: Mat4): void {
    const f = this.field(name);
    assert(f.type === "mat4", `字段 ${name} 不是 mat4`);
    matrix.writeTo(this._f32, f.offset);
  }

  /** 向量/标量数组（std140 每个元素按 stride 对齐）。 */
  setArray(name: string, values: ArrayLike<number> | number[]): void {
    const f = this.field(name);
    assert(f.count > 1, `字段 ${name} 不是数组`);
    const elementFloats =
      f.type === "f32"
        ? 1
        : f.type === "vec2"
          ? 2
          : f.type === "vec3"
            ? 3
            : f.type === "vec4"
              ? 4
              : 16; // mat4
    assert(values.length <= f.count * elementFloats, `字段 ${name} 数组长度超限`);
    for (let e = 0; e < f.count; e++) {
      const base = this.indexOffset(name, e) / 4;
      for (let k = 0; k < elementFloats; k++) {
        const idx = e * elementFloats + k;
        if (idx < values.length) this._f32[base + k] = values[idx]!;
        else this._f32[base + k] = 0;
      }
    }
  }

  /** 把整块 CPU 数据写入 GPU 缓冲。 */
  flush(): void {
    this.buffer.write(this._bytes);
  }
}
