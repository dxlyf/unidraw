/**
 * 后端无关的统一 GPU 类型定义。
 *
 * 设计目标：WebGL2 / WebGPU / Mock 三种后端共用同一套描述符与枚举，
 * 由各后端翻译为原生 API 状态。
 */

// ---------------------------------------------------------------------------
// 后端
// ---------------------------------------------------------------------------

export type BackendKind = "webgl2" | "webgpu" | "mock";

/** 创建设备时对后端的偏好 / 探测顺序。 */
export type BackendPreference = "auto" | BackendKind | BackendKind[];

// ---------------------------------------------------------------------------
// 缓冲
// ---------------------------------------------------------------------------

export const BufferUsage = {
  VERTEX: 1 << 0,
  INDEX: 1 << 1,
  UNIFORM: 1 << 2,
  STORAGE: 1 << 3,
  INDIRECT: 1 << 4,
  COPY_SRC: 1 << 5,
  COPY_DST: 1 << 6,
} as const;

export type BufferUsageFlags = number;

export type IndexFormat = "uint16" | "uint32";

// ---------------------------------------------------------------------------
// 顶点
// ---------------------------------------------------------------------------

export type VertexStepMode = "vertex" | "instance";

/** 顶点属性格式（命名与 WebGPU 一致）。 */
export type VertexFormat =
  | "float32"
  | "float32x2"
  | "float32x3"
  | "float32x4"
  | "unorm8"
  | "unorm8x2"
  | "unorm8x4"
  | "snorm8"
  | "snorm8x2"
  | "snorm8x4"
  | "uint16x2"
  | "uint16x4";

// ---------------------------------------------------------------------------
// 图元与光栅化
// ---------------------------------------------------------------------------

export type PrimitiveTopology = "point-list" | "line-list" | "line-strip" | "triangle-list" | "triangle-strip";

export type FrontFace = "ccw" | "cw";
export type CullMode = "none" | "front" | "back";

// ---------------------------------------------------------------------------
// 深度/混合
// ---------------------------------------------------------------------------

export type CompareFunction = "never" | "less" | "equal" | "less-equal" | "greater" | "not-equal" | "greater-equal" | "always";

export type BlendFactor =
  | "zero"
  | "one"
  | "src"
  | "one-minus-src"
  | "src-alpha"
  | "one-minus-src-alpha"
  | "dst"
  | "one-minus-dst"
  | "dst-alpha"
  | "one-minus-dst-alpha"
  | "src-alpha-saturated"
  | "constant"
  | "one-minus-constant";

export type BlendOperation = "add" | "subtract" | "reverse-subtract" | "min" | "max";

export type LoadOp = "clear" | "load";
export type StoreOp = "store" | "discard";

// ---------------------------------------------------------------------------
// 纹理
// ---------------------------------------------------------------------------

export const TextureUsage = {
  COPY_SRC: 1 << 0,
  COPY_DST: 1 << 1,
  TEXTURE_BINDING: 1 << 2,
  STORAGE_BINDING: 1 << 3,
  RENDER_ATTACHMENT: 1 << 4,
} as const;

export type TextureUsageFlags = number;

export type TextureFormat =
  | "r8unorm"
  | "rg8unorm"
  | "rgba8unorm"
  | "rgba8unorm-srgb"
  | "bgra8unorm"
  | "bgra8unorm-srgb"
  | "r32float"
  | "rgba16float"
  | "rgba32float"
  | "depth32float"
  | "depth24plus";

export type TextureDimension = "2d";

export type AddressMode = "clamp-to-edge" | "repeat" | "mirror-repeat";
export type FilterMode = "nearest" | "linear";
export type MipmapFilterMode = "nearest" | "linear";

// ---------------------------------------------------------------------------
// 通用结构
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 可见性（预留给计算阶段扩展）
// ---------------------------------------------------------------------------

export const ShaderStage = {
  VERTEX: 1 << 0,
  FRAGMENT: 1 << 1,
  COMPUTE: 1 << 2,
} as const;

export type ShaderStageFlags = number;

/** 是否是 2D 纹理格式 */
export function isDepthFormat(format: TextureFormat): boolean {
  return format === "depth32float" || format === "depth24plus";
}
