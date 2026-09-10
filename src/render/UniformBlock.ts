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
  /**
   * 环形槽数量（> 1 时启用「动态偏移 UBO」）：
   * buffer 被划分为 slots 个对齐槽，每槽一个 block，
   * 通过 `setBindGroup(index, group, [slot * stride])` 选择实际读取的槽。
   * 用于共享材质逐物体更新矩阵的场景，避免每物体一个 buffer/bind group。
   */
  slots?: number;
}

export class UniformBlock {
  readonly device: Device;
  readonly layout: Std140Layout;
  readonly buffer: Buffer;
  readonly label: string | undefined;
  /** 单个槽的字节跨度（= block 大小按 minUniformBufferOffsetAlignment 对齐） */
  readonly stride: number;
  /** 槽数量（缺省 1，即普通 UBO） */
  readonly slots: number;
  private readonly _f32: Float32Array;
  private readonly _bytes: ArrayBuffer;
  /** 环形槽的 CPU 暂存（slots × stride） */
  private readonly _staging: ArrayBuffer;
  private readonly _bytesF32: Float32Array;
  private _pending = false;
  private _pendingStart = -1;
  private _pendingEnd = -1;

  constructor(device: Device, options: UniformBlockOptions) {
    this.device = device;
    this.label = options.label;
    this.layout = std140Layout(options.fields);
    this.slots = Math.max(1, Math.floor(options.slots ?? 1));
    const alignment = Math.max(1, device.limits.minUniformBufferOffsetAlignment ?? 256);
    this.stride = this.slots > 1 ? align(this.layout.size, alignment) : this.layout.size;
    this._bytes = new ArrayBuffer(this.layout.size);
    this._f32 = new Float32Array(this._bytes);
    this._staging = new ArrayBuffer(this.stride * this.slots);
    this._bytesF32 = new Float32Array(this._staging);
    this.buffer = device.createBuffer({
      label: options.label ? `${options.label}-ubo` : undefined,
      size: this.stride * this.slots,
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

  /** 把整块 CPU 数据写入 GPU 缓冲（槽 0 / 普通 UBO）。 */
  flush(): void {
    this.buffer.write(this._bytes);
  }

  /**
   * 用外部按同一 std140 布局打包好的浮点数据整体覆盖本块。
   * （例如灯光：`LightsState.data` 直接倒进来，避免逐字段 setVec4）
   */
  setRaw(data: Float32Array): void {
    assert(
      data.length === this._f32.length,
      `setRaw 数据长度不匹配：期望 ${this._f32.length} 个 float，实际 ${data.length}`,
    );
    this._f32.set(data);
  }

  /**
   * 把当前 CPU 数据写入指定槽 —— **不立即上传**，只记录待写区间。
   *
   * 逐 draw 调用（配合 `flushPending()` 在提交前一次性上传）可以把
   * 「每 draw 一次 64B writeBuffer」合并成「每帧一次大写入」：
   * WebGPU 上 6000 draws 的 6000 次队列操作会降到几次，这是 draw call 压力的关键优化。
   */
  flushSlot(slot: number): void {
    assert(slot >= 0 && slot < this.slots, `uniform 槽位 ${slot} 超出范围（slots=${this.slots}）`);
    const offset = slot * this.stride;
    this._bytesF32.set(this._f32, offset / 4);
    const end = offset + this.layout.size;
    if (this._pendingStart < 0) {
      this._pendingStart = offset;
      this._pendingEnd = end;
    } else {
      if (offset < this._pendingStart) this._pendingStart = offset;
      if (end > this._pendingEnd) this._pendingEnd = end;
    }
    this._pending = true;
  }

  /**
   * 把累积的槽位数据一次性上传（区间为 [首个待写槽, 最后一个待写槽] 的并集）。
   * 由 `BaseMaterial` 注册到 `Device.onBeforeSubmit()`，因此不需要业务代码关心。
   */
  flushPending(): void {
    if (!this._pending) return;
    const start = this._pendingStart;
    const end = this._pendingEnd;
    this._pending = false;
    this._pendingStart = -1;
    this._pendingEnd = -1;
    this.buffer.write(new Uint8Array(this._staging, start, end - start), start);
  }

  /** 是否有等待上传的数据 */
  get hasPending(): boolean {
    return this._pending;
  }
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}
