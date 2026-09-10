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
import { Vec3 } from "../math/vec3.js";
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

export interface GeometryOptions {
  /**
   * 是否在 CPU 侧保留顶点/索引数据（用于射线拾取、导出、子网格等）。
   * 默认 true；纯静态大网格可设为 false 以省内存。
   */
  retainCPU?: boolean;
}

export class Geometry {
  readonly device: Device;
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly indexFormat: IndexFormat | null;
  vertexBuffer: Buffer;
  indexBuffer: Buffer | null;

  /** 局部空间包围球（中心 + 半径） */
  readonly boundingSphereCenter: Vec3;
  readonly boundingSphereRadius: number;
  /** 局部空间 AABB */
  readonly aabbMin: Vec3;
  readonly aabbMax: Vec3;
  /** 保留的 CPU 数据（retainCPU !== false 时可用），供拾取/导出 */
  readonly positionsCPU: Float32Array | null;
  readonly indicesCPU: Uint32Array | null;

  private constructor(device: Device, data: GeometryData, options: GeometryOptions = {}) {
    this.device = device;
    const count = data.positions.length / 3;
    assert(Number.isInteger(count) && count >= 3, "positions 长度必须是 3 的整数倍");
    this.vertexCount = count;

    // ---- 包围体（局部空间） ----
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      const x = data.positions[i * 3] ?? 0;
      const y = data.positions[i * 3 + 1] ?? 0;
      const z = data.positions[i * 3 + 2] ?? 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    this.aabbMin = new Vec3(minX, minY, minZ);
    this.aabbMax = new Vec3(maxX, maxY, maxZ);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    // 球半径 = 顶点到 AABB 中心的最大距离（比 AABB 半对角线更紧）
    let r2 = 0;
    for (let i = 0; i < count; i++) {
      const dx = (data.positions[i * 3] ?? 0) - cx;
      const dy = (data.positions[i * 3 + 1] ?? 0) - cy;
      const dz = (data.positions[i * 3 + 2] ?? 0) - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) r2 = d2;
    }
    this.boundingSphereCenter = new Vec3(cx, cy, cz);
    this.boundingSphereRadius = Math.sqrt(r2);

    // ---- CPU 数据 ----
    if (options.retainCPU !== false) {
      this.positionsCPU = new Float32Array(count * 3);
      for (let i = 0; i < count * 3; i++) this.positionsCPU[i] = data.positions[i] ?? 0;
    } else {
      this.positionsCPU = null;
    }

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
      // 注意：不能 Math.max(...indices) 展开 —— 大量索引会导致调用栈溢出
      let maxIndex = 0;
      for (let i = 0; i < data.indices.length; i++) {
        const v = data.indices[i]!;
        if (v > maxIndex) maxIndex = v;
      }
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
      if (options.retainCPU !== false) {
        const idx = new Uint32Array(data.indices.length);
        for (let i = 0; i < data.indices.length; i++) idx[i] = data.indices[i] ?? 0;
        this.indicesCPU = idx;
      } else {
        this.indicesCPU = null;
      }
    } else {
      this.indexFormat = null;
      this.indexCount = 0;
      this.indexBuffer = null;
      this.indicesCPU = null;
    }
  }

  /** 依据 GeometryData 创建并上传 GPU 几何体。 */
  static create(device: Device, data: GeometryData, options?: GeometryOptions): Geometry {
    return new Geometry(device, data, options);
  }

  /** 是否有可供 CPU 拾取的三角形数据 */
  get hasCPUData(): boolean {
    return this.positionsCPU !== null;
  }

  destroy(): void {
    this.vertexBuffer.destroy();
    this.indexBuffer?.destroy();
  }
}
