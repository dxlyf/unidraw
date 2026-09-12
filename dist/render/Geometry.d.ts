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
import { Vec3 } from "../math/vec3.js";
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
export declare const GEOMETRY_STRIDE = 32;
export declare const POSITION_OFFSET = 0;
export declare const NORMAL_OFFSET = 12;
export declare const UV_OFFSET = 24;
export interface GeometryOptions {
    /**
     * 是否在 CPU 侧保留顶点/索引数据（用于射线拾取、导出、子网格等）。
     * 默认 true；纯静态大网格可设为 false 以省内存。
     */
    retainCPU?: boolean;
}
export declare class Geometry {
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
    private constructor();
    /** 依据 GeometryData 创建并上传 GPU 几何体。 */
    static create(device: Device, data: GeometryData, options?: GeometryOptions): Geometry;
    /** 是否有可供 CPU 拾取的三角形数据 */
    get hasCPUData(): boolean;
    destroy(): void;
}
//# sourceMappingURL=Geometry.d.ts.map