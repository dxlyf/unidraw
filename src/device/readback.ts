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
import { assert } from "../util/assert.js";

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

const READABLE_UINT8: ReadonlySet<string> = new Set(["rgba8unorm", "rgba8unorm-srgb", "bgra8unorm", "bgra8unorm-srgb"]);
const READABLE_FLOAT: ReadonlySet<string> = new Set(["rgba32float", "depth32float", "depth24plus"]);
const DEPTH: ReadonlySet<string> = new Set(["depth32float", "depth24plus"]);


export function assertReadableFormat(format: TextureFormat, type: ReadPixelsType = "uint8"): void {
  const ok = type === "float32" ? READABLE_FLOAT.has(format) : READABLE_UINT8.has(format);
  assert(
    ok,
    type === "float32"
      ? `type:"float32" 的回读仅支持 rgba32float / depth32float / depth24plus，当前为 ${format}`
      : `readTexturePixels（默认 uint8）仅支持 rgba8unorm / rgba8unorm-srgb / bgra8unorm / bgra8unorm-srgb，当前为 ${format}`,
  );
}

/** 归一化读回区域（含边界与格式校验）。 */
export function resolveReadRect(texture: Texture, options: ReadPixelsOptions = {}): ReadRect {
  const type = options.type ?? "uint8";
  assertReadableFormat(texture.format, type);
  const x = Math.max(0, Math.floor(options.x ?? 0));
  const y = Math.max(0, Math.floor(options.y ?? 0));
  const width = Math.max(1, Math.floor(options.width ?? texture.width - x));
  const height = Math.max(1, Math.floor(options.height ?? texture.height - y));
  assert(x + width <= texture.width && y + height <= texture.height, "readTexturePixels 区域越界");
  const bgra = texture.format === "bgra8unorm" || texture.format === "bgra8unorm-srgb";
  const depth = DEPTH.has(texture.format);
  const float = type === "float32";
  const bytesPerTexel = float ? (depth ? 4 : 16) : 4;
  const layer = Math.max(0, Math.floor(options.layer ?? 0));
  assert(layer < texture.depthOrArrayLayers, `readTexturePixels 层号越界：${layer} >= ${texture.depthOrArrayLayers}`);
  return { x, y, width, height, layer, bgra, bytesPerTexel, float, depth };
}

/** 上下翻转（WebGL2 的 readPixels 自下而上）。 */
export function flipRowsInPlace(data: Uint8Array, width: number, height: number, bytesPerTexel = 4): void {
  const rowBytes = width * bytesPerTexel;
  const tmp = new Uint8Array(rowBytes);
  for (let top = 0, bottom = height - 1; top < bottom; top++, bottom--) {
    const a = top * rowBytes;
    const b = bottom * rowBytes;
    tmp.set(data.subarray(a, a + rowBytes));
    data.copyWithin(a, b, b + rowBytes);
    data.set(tmp, b);
  }
}

/** BGRA → RGBA 原地交换。 */
export function swizzleBgraToRgbaInPlace(data: Uint8Array): void {
  for (let i = 0; i < data.length; i += 4) {
    const b = data[i]!;
    data[i] = data[i + 2]!;
    data[i + 2] = b;
  }
}

/** 深度值（单通道浮点）铺成 RGBA 浮点：R = 深度，GBA = 0/0/1。 */
export function expandDepthToRgbaFloat(depth: Float32Array, out: Float32Array): void {
  for (let i = 0, j = 0; i < depth.length; i++, j += 4) {
    out[j] = depth[i]!;
    out[j + 1] = 0;
    out[j + 2] = 0;
    out[j + 3] = 1;
  }
}

/** 从带行间距的原始数据中拷贝出紧凑数据（WebGPU copyTextureToBuffer 的行对齐）。 */
export function repackRows(
  src: Uint8Array,
  bytesPerRow: number,
  width: number,
  height: number,
  out: Uint8Array,
  bytesPerTexel = 4,
): void {
  const tight = width * bytesPerTexel;
  for (let row = 0; row < height; row++) {
    const from = row * bytesPerRow;
    out.set(src.subarray(from, from + tight), row * tight);
  }
}
