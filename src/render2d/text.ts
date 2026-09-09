/**
 * 文字：通过隐藏 2D canvas 把字形栅格化为纹理并缓存，
 * 再以“纹理四边形 + 顶点色”绘制（浏览器环境；非浏览器调用会给出明确错误）。
 */

import type { Device } from "../device/Device.js";
import type { Texture } from "../device/resources.js";
import { TextureUsage } from "../gpu/types.js";

export interface GlyphInfo {
  texture: Texture;
  /** 纹素尺寸 */
  width: number;
  height: number;
  /** 相对基线锚点：文字最左墨迹相对 x 的偏移 */
  left: number;
  /** 基线到字形顶部的距离（向上） */
  ascent: number;
}

const MAX_GLYPHS = 96;

function hasDocument(): boolean {
  return typeof document !== "undefined";
}

export class TextRenderer {
  private readonly device: Device;
  private cache = new Map<string, GlyphInfo>();

  constructor(device: Device) {
    this.device = device;
  }

  private evictIfNeeded(): void {
    while (this.cache.size >= MAX_GLYPHS) {
      const first = this.cache.keys().next().value as string | undefined;
      if (first === undefined) break;
      const g = this.cache.get(first);
      if (g) g.texture.destroy();
      this.cache.delete(first);
    }
  }

  /** 取字形（命中缓存直接返回，否则栅格化） */
  getGlyph(text: string, font: string): GlyphInfo {
    const key = `${font}\u0000${text}`;
    const hit = this.cache.get(key);
    if (hit) {
      // LRU：重新插入到尾部
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const glyph = this.rasterize(text, font);
    this.evictIfNeeded();
    this.cache.set(key, glyph);
    return glyph;
  }

  private rasterize(text: string, font: string): GlyphInfo {
    if (!hasDocument()) {
      throw new Error("[unidraw] fillText 需要浏览器环境（依赖 DOM canvas 栅格化字形）");
    }
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("[unidraw] 无法创建 2d 画布");
    ctx.font = font;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const m = ctx.measureText(text);
    const pad = 2;
    const hasActual = typeof m.actualBoundingBoxLeft === "number";
    const bboxLeft = hasActual ? m.actualBoundingBoxLeft : 0;
    const bboxRight = hasActual ? m.actualBoundingBoxRight : m.width;
    const ascent = hasActual ? Math.max(1, m.actualBoundingBoxAscent) : Math.ceil(parseFloat(font) * 0.8 || 20);
    const descent = hasActual ? Math.max(1, m.actualBoundingBoxDescent) : Math.ceil(parseFloat(font) * 0.2 || 5);
    const w = Math.max(1, Math.ceil(bboxRight - bboxLeft) + pad * 2);
    const h = Math.max(1, Math.ceil(ascent + descent) + pad * 2);
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (!g) throw new Error("[unidraw] 无法创建 2d 画布");
    g.font = font;
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#ffffff";
    g.fillText(text, pad - bboxLeft, pad + ascent);

    const image = g.getImageData(0, 0, w, h);
    const texture = this.device.createTexture({
      label: `text:${text.slice(0, 12)}`,
      width: w,
      height: h,
      format: "rgba8unorm",
      usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST,
    });
    texture.upload(image.data);
    return { texture, width: w, height: h, left: bboxLeft, ascent };
  }

  clear(): void {
    for (const g of this.cache.values()) g.texture.destroy();
    this.cache.clear();
  }
}
