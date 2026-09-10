/**
 * 纹理回读（readback）公共工具：三后端统一的坐标/格式约定。
 *
 * 约定：
 * - 坐标系为**左上原点**（与 WebGPU 一致，WebGL2 后端内部翻转）；
 * - 输出始终是紧凑排列的 8bit RGBA（`width*height*4` 字节）；
 * - 支持的读回格式：`rgba8unorm` / `rgba8unorm-srgb` / `bgra8unorm` / `bgra8unorm-srgb`
 *   （后两者内部会 swizzle 成 RGBA）。
 */

import type { Texture } from "./resources.js";
import type { TextureFormat } from "../gpu/types.js";
import { assert } from "../util/assert.js";

export interface ReadPixelsOptions {
  /** 左上原点 X（默认 0） */
  x?: number;
  /** 左上原点 Y（默认 0） */
  y?: number;
  /** 读取宽度（默认到纹理右边界） */
  width?: number;
  /** 读取高度（默认到纹理下边界） */
  height?: number;
}

export interface ReadRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 是否为 BGRA 纹理（读回后需 swizzle） */
  bgra: boolean;
}

const READABLE: ReadonlySet<string> = new Set(["rgba8unorm", "rgba8unorm-srgb", "bgra8unorm", "bgra8unorm-srgb"]);

export function assertReadableFormat(format: TextureFormat): void {
  assert(
    READABLE.has(format),
    `readTexturePixels 仅支持 rgba8unorm / rgba8unorm-srgb / bgra8unorm / bgra8unorm-srgb，当前为 ${format}`,
  );
}

/** 归一化读回区域（含边界与格式校验）。 */
export function resolveReadRect(texture: Texture, options: ReadPixelsOptions = {}): ReadRect {
  assertReadableFormat(texture.format);
  const x = Math.max(0, Math.floor(options.x ?? 0));
  const y = Math.max(0, Math.floor(options.y ?? 0));
  const width = Math.max(1, Math.floor(options.width ?? texture.width - x));
  const height = Math.max(1, Math.floor(options.height ?? texture.height - y));
  assert(x + width <= texture.width && y + height <= texture.height, "readTexturePixels 区域越界");
  const bgra = texture.format === "bgra8unorm" || texture.format === "bgra8unorm-srgb";
  return { x, y, width, height, bgra };
}

/** 上下翻转（WebGL2 的 readPixels 自下而上）。 */
export function flipRowsInPlace(data: Uint8Array, width: number, height: number): void {
  const rowBytes = width * 4;
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

/** 从带行间距的原始数据中拷贝出紧凑 RGBA（WebGPU copyTextureToBuffer 的行对齐）。 */
export function repackRows(src: Uint8Array, bytesPerRow: number, width: number, height: number, out: Uint8Array): void {
  const tight = width * 4;
  for (let row = 0; row < height; row++) {
    const from = row * bytesPerRow;
    out.set(src.subarray(from, from + tight), row * tight);
  }
}
