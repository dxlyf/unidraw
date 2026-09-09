/**
 * 纹理工具：程序化像素纹理与 DOM 图像源上传。
 * （WebGL2/WebGPU 统一走“CPU 像素 → device 纹理”路径。）
 */

import type { Device } from "../device/Device.js";
import { Texture } from "../device/resources.js";
import { Color } from "../math/color.js";
import { assert } from "../util/assert.js";
import { TextureUsage } from "../gpu/types.js";

export interface PixelTextureOptions {
  label?: string;
  format?: "rgba8unorm" | "rgba8unorm-srgb";
}

function rgbaTexture(device: Device, width: number, height: number, label: string | undefined, format: "rgba8unorm" | "rgba8unorm-srgb"): Texture {
  return device.createTexture({
    label,
    width,
    height,
    format,
    usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST,
  });
}

/** 纯色纹理（2x2，避免采样边界问题）。 */
export function createSolidTexture(device: Device, color: Color, label = "solid-texture"): Texture {
  const w = 2;
  const h = 2;
  const texture = rgbaTexture(device, w, h, label, "rgba8unorm");
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = Math.round(color.r * 255);
    rgba[i * 4 + 1] = Math.round(color.g * 255);
    rgba[i * 4 + 2] = Math.round(color.b * 255);
    rgba[i * 4 + 3] = Math.round(color.a * 255);
  }
  texture.upload(rgba);
  return texture;
}

export interface CheckerTextureOptions {
  label?: string;
  /** 单格像素数 */
  cell?: number;
  /** 长宽（像素） */
  width?: number;
  height?: number;
  colorA?: Color;
  colorB?: Color;
  format?: "rgba8unorm" | "rgba8unorm-srgb";
}

/** 棋盘格纹理（用于纹理示例）。 */
export function createCheckerTexture(device: Device, options: CheckerTextureOptions = {}): Texture {
  const cell = Math.max(1, options.cell ?? 16);
  const width = options.width ?? cell * 8;
  const height = options.height ?? cell * 8;
  const ca = options.colorA ?? new Color(0.15, 0.16, 0.2, 1);
  const cb = options.colorB ?? new Color(0.85, 0.87, 0.95, 1);
  const texture = rgbaTexture(device, width, height, options.label, options.format ?? "rgba8unorm");
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dark = ((Math.floor(x / cell) + Math.floor(y / cell)) & 1) === 0;
      const c = dark ? ca : cb;
      const i = (y * width + x) * 4;
      rgba[i] = Math.round(c.r * 255);
      rgba[i + 1] = Math.round(c.g * 255);
      rgba[i + 2] = Math.round(c.b * 255);
      rgba[i + 3] = Math.round(c.a * 255);
    }
  }
  texture.upload(rgba);
  return texture;
}

export type CanvasImageSourceLike = CanvasImageSource & {
  readonly width?: number;
  readonly height?: number;
  readonly naturalWidth?: number;
  readonly naturalHeight?: number;
  readonly videoWidth?: number;
  readonly videoHeight?: number;
};

function sourceSize(source: CanvasImageSourceLike): { width: number; height: number } {
  const w = source.naturalWidth ?? source.videoWidth ?? source.width;
  const h = source.naturalHeight ?? source.videoHeight ?? source.height;
  assert(w && h && w > 0 && h > 0, "图像源尺寸不可用（跨域图像可能污染画布）");
  return { width: w, height: h };
}

/**
 * 从任意 CanvasImageSource（HTMLImageElement / ImageBitmap / HTMLCanvasElement / ImageData…）
 * 采样为纹理。需要浏览器 DOM；跨域图像可能被画布污染。
 */
export function textureFromImageSource(device: Device, source: CanvasImageSourceLike, options: { label?: string; format?: "rgba8unorm" | "rgba8unorm-srgb" } = {}): Texture {
  assert(typeof document !== "undefined", "textureFromImageSource 需要浏览器环境");
  const { width, height } = sourceSize(source);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  assert(ctx, "无法创建 2d 画布");
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, width, height);
  const texture = rgbaTexture(device, width, height, options.label, options.format ?? "rgba8unorm");
  texture.upload(image.data);
  return texture;
}

/** 通过 <img> 加载 URL 图像并创建纹理。 */
export async function textureFromUrl(device: Device, url: string, options: { label?: string; format?: "rgba8unorm" | "rgba8unorm-srgb"; crossOrigin?: string } = {}): Promise<Texture> {
  assert(typeof document !== "undefined", "textureFromUrl 需要浏览器环境");
  const img = new Image();
  if (options.crossOrigin) img.crossOrigin = options.crossOrigin;
  img.src = url;
  await img.decode();
  return textureFromImageSource(device, img, options);
}

export { Texture };
