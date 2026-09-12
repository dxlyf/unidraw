/**
 * 纹理回读（readback）公共工具：三后端统一的坐标/格式约定。
 *
 * 约定：
 * - 坐标系为**左上原点**（与 WebGPU 一致，WebGL2 后端内部翻转）；
 * - 输出紧凑排列；每纹素字节数由 `type` 决定：
 *   - `"uint8"`（默认）：8bit RGBA，`width*height*4` 字节，支持
 *     `rgba8unorm / rgba8unorm-srgb / bgra8unorm / bgra8unorm-srgb`（后两者内部 swizzle）；
 *   - `"float32"`：每通道 32 位浮点，`width*height*16` 字节，支持 `rgba32float`
 *     以及深度纹理（`depth32float` / `depth24plus`，单通道值铺在 R 上，GBA 为 0/1）。
 */
import type { Texture } from "./resources.js";
import type { TextureFormat } from "../gpu/types.js";
export type ReadPixelsType = "uint8" | "float32";
export interface ReadPixelsOptions {
    /** 左上原点 X（默认 0） */
    x?: number;
    /** 左上原点 Y（默认 0） */
    y?: number;
    /** 读取宽度（默认到纹理右边界） */
    width?: number;
    /** 读取高度（默认到纹理下边界） */
    height?: number;
    /** 输出数据类型（默认 `"uint8"`） */
    type?: ReadPixelsType;
    /** 层号（3D / 2D 数组的层，cube 的面；默认 0） */
    layer?: number;
}
export interface ReadRect {
    x: number;
    y: number;
    width: number;
    height: number;
    /** 读哪一层（3D/数组层号 / cube 面序号） */
    layer: number;
    /** 是否为 BGRA 纹理（读回后需 swizzle） */
    bgra: boolean;
    /** 每纹素字节数（uint8 RGBA = 4，float32 = 16，深度 = 4） */
    bytesPerTexel: number;
    /** 是否浮点回读 */
    float: boolean;
    /** 是否为深度格式 */
    depth: boolean;
}
export declare function assertReadableFormat(format: TextureFormat, type?: ReadPixelsType): void;
/** 归一化读回区域（含边界与格式校验）。 */
export declare function resolveReadRect(texture: Texture, options?: ReadPixelsOptions): ReadRect;
/** 上下翻转（WebGL2 的 readPixels 自下而上）。 */
export declare function flipRowsInPlace(data: Uint8Array, width: number, height: number, bytesPerTexel?: number): void;
/** BGRA → RGBA 原地交换。 */
export declare function swizzleBgraToRgbaInPlace(data: Uint8Array): void;
/** 深度值（单通道浮点）铺成 RGBA 浮点：R = 深度，GBA = 0/0/1。 */
export declare function expandDepthToRgbaFloat(depth: Float32Array, out: Float32Array): void;
/** 从带行间距的原始数据中拷贝出紧凑数据（WebGPU copyTextureToBuffer 的行对齐）。 */
export declare function repackRows(src: Uint8Array, bytesPerRow: number, width: number, height: number, out: Uint8Array, bytesPerTexel?: number): void;
//# sourceMappingURL=readback.d.ts.map