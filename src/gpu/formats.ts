import type { IndexFormat, TextureFormat, VertexFormat } from "./types.js";

/**
 * 顶点格式元信息：同一份描述被翻译到 WebGL2（gl.vertexAttribPointer）
 * 与 WebGPU（vertex attribute format）。
 */
export interface VertexFormatInfo {
  /** 单个元素字节数 */
  size: number;
  /** 分量数 */
  components: number;
  /** WebGL2 数据类型常量名（用于转换表 gl[type]） */
  glType: "FLOAT" | "UNSIGNED_BYTE" | "BYTE" | "UNSIGNED_SHORT" | "SHORT";
  /** WebGL2 是否归一化 */
  normalized: boolean;
  /** WebGPU 顶点格式字符串 */
  wgslFormat: string;
  /** 是否整数类型 */
  integer: boolean;
}

const VERTEX_FORMATS: Record<VertexFormat, VertexFormatInfo> = {
  float32: { size: 4, components: 1, glType: "FLOAT", normalized: false, wgslFormat: "float32", integer: false },
  float32x2: { size: 8, components: 2, glType: "FLOAT", normalized: false, wgslFormat: "float32x2", integer: false },
  float32x3: { size: 12, components: 3, glType: "FLOAT", normalized: false, wgslFormat: "float32x3", integer: false },
  float32x4: { size: 16, components: 4, glType: "FLOAT", normalized: false, wgslFormat: "float32x4", integer: false },
  unorm8: { size: 1, components: 1, glType: "UNSIGNED_BYTE", normalized: true, wgslFormat: "unorm8", integer: false },
  unorm8x2: { size: 2, components: 2, glType: "UNSIGNED_BYTE", normalized: true, wgslFormat: "unorm8x2", integer: false },
  unorm8x4: { size: 4, components: 4, glType: "UNSIGNED_BYTE", normalized: true, wgslFormat: "unorm8x4", integer: false },
  snorm8: { size: 1, components: 1, glType: "BYTE", normalized: true, wgslFormat: "snorm8", integer: false },
  snorm8x2: { size: 2, components: 2, glType: "BYTE", normalized: true, wgslFormat: "snorm8x2", integer: false },
  snorm8x4: { size: 4, components: 4, glType: "BYTE", normalized: true, wgslFormat: "snorm8x4", integer: false },
  uint16x2: { size: 4, components: 2, glType: "UNSIGNED_SHORT", normalized: false, wgslFormat: "uint16x2", integer: true },
  uint16x4: { size: 8, components: 4, glType: "UNSIGNED_SHORT", normalized: false, wgslFormat: "uint16x4", integer: true },
};

export function vertexFormatInfo(format: VertexFormat): VertexFormatInfo {
  const info = VERTEX_FORMATS[format];
  if (!info) throw new Error(`[unidraw] 不支持的顶点格式：${format}`);
  return info;
}

export const INDEX_FORMAT_BYTES: Record<IndexFormat, number> = {
  uint16: 2,
  uint32: 4,
};

// ---------------------------------------------------------------------------
// 纹理格式
// ---------------------------------------------------------------------------

export interface TextureFormatInfo {
  /** 每纹素字节数（未压缩） */
  bytesPerTexel: number;
  /** 分量数 */
  channels: number;
  /** 是否深度格式 */
  depth: boolean;
  /** WebGL2 内部格式常量名 */
  glInternal: string;
  /** WebGL2 像素格式常量名 */
  glFormat: string;
  /** WebGL2 像素类型常量名 */
  glType: string;
}

const TEXTURE_FORMATS: Record<TextureFormat, TextureFormatInfo> = {
  r8unorm: { bytesPerTexel: 1, channels: 1, depth: false, glInternal: "R8", glFormat: "RED", glType: "UNSIGNED_BYTE" },
  rg8unorm: { bytesPerTexel: 2, channels: 2, depth: false, glInternal: "RG8", glFormat: "RG", glType: "UNSIGNED_BYTE" },
  rgba8unorm: { bytesPerTexel: 4, channels: 4, depth: false, glInternal: "RGBA8", glFormat: "RGBA", glType: "UNSIGNED_BYTE" },
  "rgba8unorm-srgb": { bytesPerTexel: 4, channels: 4, depth: false, glInternal: "SRGB8_ALPHA8", glFormat: "RGBA", glType: "UNSIGNED_BYTE" },
  bgra8unorm: { bytesPerTexel: 4, channels: 4, depth: false, glInternal: "RGBA8", glFormat: "RGBA", glType: "UNSIGNED_BYTE" },
  "bgra8unorm-srgb": { bytesPerTexel: 4, channels: 4, depth: false, glInternal: "SRGB8_ALPHA8", glFormat: "RGBA", glType: "UNSIGNED_BYTE" },
  r32float: { bytesPerTexel: 4, channels: 1, depth: false, glInternal: "R32F", glFormat: "RED", glType: "FLOAT" },
  rgba16float: { bytesPerTexel: 8, channels: 4, depth: false, glInternal: "RGBA16F", glFormat: "RGBA", glType: "HALF_FLOAT" },
  rgba32float: { bytesPerTexel: 16, channels: 4, depth: false, glInternal: "RGBA32F", glFormat: "RGBA", glType: "FLOAT" },
  depth32float: { bytesPerTexel: 4, channels: 1, depth: true, glInternal: "DEPTH_COMPONENT32F", glFormat: "DEPTH_COMPONENT", glType: "FLOAT" },
  depth24plus: { bytesPerTexel: 4, channels: 1, depth: true, glInternal: "DEPTH_COMPONENT24", glFormat: "DEPTH_COMPONENT", glType: "UNSIGNED_INT" },
};

export function textureFormatInfo(format: TextureFormat): TextureFormatInfo {
  const info = TEXTURE_FORMATS[format];
  if (!info) throw new Error(`[unidraw] 不支持的纹理格式：${format}`);
  return info;
}
