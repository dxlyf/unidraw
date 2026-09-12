/**
 * 后端无关的统一 GPU 类型定义。
 *
 * 设计目标：WebGL2 / WebGPU / Mock 三种后端共用同一套描述符与枚举，
 * 由各后端翻译为原生 API 状态。
 */
export type BackendKind = "webgl2" | "webgpu" | "mock";
/** 创建设备时对后端的偏好 / 探测顺序。 */
export type BackendPreference = "auto" | BackendKind | BackendKind[];
export declare const BufferUsage: {
    readonly VERTEX: number;
    readonly INDEX: number;
    readonly UNIFORM: number;
    readonly STORAGE: number;
    readonly INDIRECT: number;
    readonly COPY_SRC: number;
    readonly COPY_DST: number;
};
export type BufferUsageFlags = number;
export type IndexFormat = "uint16" | "uint32";
export type VertexStepMode = "vertex" | "instance";
/** 顶点属性格式（命名与 WebGPU 一致）。 */
export type VertexFormat = "float32" | "float32x2" | "float32x3" | "float32x4" | "unorm8" | "unorm8x2" | "unorm8x4" | "snorm8" | "snorm8x2" | "snorm8x4" | "uint16x2" | "uint16x4";
export type PrimitiveTopology = "point-list" | "line-list" | "line-strip" | "triangle-list" | "triangle-strip";
export type FrontFace = "ccw" | "cw";
export type CullMode = "none" | "front" | "back";
export type CompareFunction = "never" | "less" | "equal" | "less-equal" | "greater" | "not-equal" | "greater-equal" | "always";
export type BlendFactor = "zero" | "one" | "src" | "one-minus-src" | "src-alpha" | "one-minus-src-alpha" | "dst" | "one-minus-dst" | "dst-alpha" | "one-minus-dst-alpha" | "src-alpha-saturated" | "constant" | "one-minus-constant";
export type BlendOperation = "add" | "subtract" | "reverse-subtract" | "min" | "max";
export type LoadOp = "clear" | "load";
export type StoreOp = "store" | "discard";
export declare const TextureUsage: {
    readonly COPY_SRC: number;
    readonly COPY_DST: number;
    readonly TEXTURE_BINDING: number;
    readonly STORAGE_BINDING: number;
    readonly RENDER_ATTACHMENT: number;
};
export type TextureUsageFlags = number;
export type TextureFormat = "r8unorm" | "rg8unorm" | "rgba8unorm" | "rgba8unorm-srgb" | "bgra8unorm" | "bgra8unorm-srgb" | "r32float" | "rgba16float" | "rgba32float" | "depth32float" | "depth24plus";
/**
 * 纹理维度。
 *
 * `"2d"` 之外的三态两个后端都支持（WebGL2 走 `texStorage3D` / `TEXTURE_2D_ARRAY` /
 * `TEXTURE_CUBE_MAP`，cube 的 6 个面各占一个层）；采样时着色器要按维度声明
 * （`sampler3D` / `sampler2DArray` / `samplerCube`）。
 */
export type TextureDimension = "2d" | "3d" | "2d-array" | "cube";
export type AddressMode = "clamp-to-edge" | "repeat" | "mirror-repeat";
export type FilterMode = "nearest" | "linear";
export type MipmapFilterMode = "nearest" | "linear";
export interface Extent3D {
    width: number;
    height: number;
    /** 2D 纹理恒为 1。 */
    depthOrArrayLayers?: number;
}
export interface Origin3D {
    x?: number;
    y?: number;
    z?: number;
}
/** 归一化 RGBA 清屏色。 */
export interface ColorClearValue {
    r: number;
    g: number;
    b: number;
    a: number;
}
export declare const ShaderStage: {
    readonly VERTEX: number;
    readonly FRAGMENT: number;
    readonly COMPUTE: number;
};
export type ShaderStageFlags = number;
/** 是否是 2D 纹理格式 */
export declare function isDepthFormat(format: TextureFormat): boolean;
//# sourceMappingURL=types.d.ts.map