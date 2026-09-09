/**
 * Geometry —— 顶点/索引数据的 CPU 描述与上传。
 *
 * 内置“标准布局”（single interleaved vertex buffer，stride 32B）：
 *   location 0: vec3 position (0)
 *   location 1: vec3 normal   (12)
 *   location 2: vec2 uv       (24)
 * 内置材质都基于此布局，几何体只需提供 positions + 可选 normals/uvs/indices。
 */

import type { Device } from "../device/Device.js";
import { type Buffer } from "../device/resources.js";
import { assert } from "../util/assert.js";
import { BufferUsage } from "../gpu/types.js";
import type { IndexFormat } from "../gpu/types.js";

export interface GeometryData {
  /** vec3 * n */
  positions: ArrayLike<number>;
  /** vec3 * n（缺省全 0） */
  normals?: ArrayLike<number>;
  /** vec2 * n（缺省全 0） */
  uvs?: ArrayLike<number>;
  /** 三角形索引（缺省非索引绘制） */
  indices?: ArrayLike<number>;
}

export const GEOMETRY_STRIDE = 32;
export const POSITION_OFFSET = 0;
export const NORMAL_OFFSET = 12;
export const UV_OFFSET = 24;

export class Geometry {
  readonly device: Device;
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly indexFormat: IndexFormat | null;
  vertexBuffer: Buffer;
  indexBuffer: Buffer | null;

  private constructor(device: Device, data: GeometryData) {
    this.device = device;
    const count = data.positions.length / 3;
    assert(Number.isInteger(count) && count >= 3, "positions 长度必须是 3 的整数倍");
    this.vertexCount = count;
    this.vertexBuffer = device.createBuffer({
      label: "geometry-vertex",
      size: count * GEOMETRY_STRIDE,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    });
    const interleaved = new Float32Array(count * (GEOMETRY_STRIDE / 4));
    const hasNormals = data.normals !== undefined;
    const hasUvs = data.uvs !== undefined;
    for (let i = 0; i < count; i++) {
      interleaved[i * 8] = data.positions[i * 3] ?? 0;
      interleaved[i * 8 + 1] = data.positions[i * 3 + 1] ?? 0;
      interleaved[i * 8 + 2] = data.positions[i * 3 + 2] ?? 0;
      if (hasNormals) {
        interleaved[i * 8 + 3] = data.normals![i * 3] ?? 0;
        interleaved[i * 8 + 4] = data.normals![i * 3 + 1] ?? 0;
        interleaved[i * 8 + 5] = data.normals![i * 3 + 2] ?? 0;
      }
      if (hasUvs) {
        interleaved[i * 8 + 6] = data.uvs![i * 2] ?? 0;
        interleaved[i * 8 + 7] = data.uvs![i * 2 + 1] ?? 0;
      }
    }
    this.vertexBuffer.write(interleaved);

    if (data.indices) {
      const maxIndex = Math.max(0, ...Array.from(data.indices));
      this.indexFormat = maxIndex > 0xffff ? "uint32" : "uint16";
      this.indexCount = data.indices.length;
      this.indexBuffer = device.createBuffer({
        label: "geometry-index",
        size: this.indexCount * (this.indexFormat === "uint16" ? 2 : 4),
        usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
      });
      const dst = this.indexFormat === "uint16" ? new Uint16Array(data.indices.length) : new Uint32Array(data.indices.length);
      for (let i = 0; i < data.indices.length; i++) dst[i] = data.indices[i] ?? 0;
      this.indexBuffer.write(dst);
    } else {
      this.indexFormat = null;
      this.indexCount = 0;
      this.indexBuffer = null;
    }
  }

  /** 依据 GeometryData 创建并上传 GPU 几何体。 */
  static create(device: Device, data: GeometryData): Geometry {
    return new Geometry(device, data);
  }

  destroy(): void {
    this.vertexBuffer.destroy();
    this.indexBuffer?.destroy();
  }
}
