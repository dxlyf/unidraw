/**
 * 文字：通过隐藏 2D canvas 把字形栅格化为纹理并缓存，
 * 再以“纹理四边形 + 顶点色”绘制（浏览器环境；非浏览器调用会给出明确错误）。
 */

import type { Device } from "../device/Device.js";
import type { Texture } from "../device/resources.js";
import { TextureUsage } from "../gpu/types.js";

export interface GlyphInfo {
  texture: Texture;
  /** 纹素尺寸（图集里这段文字的位图大小） */
  width: number;
  height: number;
  /**
   * 图集左上角相对**对齐点**的水平偏移（`fillText` 的 x）。
   *
   * 常见误区：不能直接把 `actualBoundingBoxLeft` 当偏移。规范里
   * `actualBoundingBoxLeft` 是「对齐点 → 墨迹左边界」的距离（向左为正），
   * 所以墨迹左边界 = 对齐点 − `actualBoundingBoxLeft`；图集左边还要再留 `pad`。
   */
  offsetX: number;
  /** 图集上边缘相对**基线**的垂直偏移（`fillText` 的 y）；向上为负 */
  offsetY: number;
}

const MAX_GLYPHS = 96;
/** 图集四周留白（纹素），避免线性采样时采到相邻内容/边界 */
const PAD = 2;

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

  /**
   * 栅格化一段文字到纹理。
   *
   * 位置约定（要让 `fillText(text,x,y)` 的落点和原生 Canvas2D 一致）：
   * - 图集内**对齐点**（`textAlign:"left"` + `textBaseline:"alphabetic"` 的原点）
   *   放在 `(PAD - inkLeft, PAD - inkTop)`，于是墨迹左边界/上边界正好落在
   *   `PAD` 处，四周各留 `PAD` 纹素；
   * - 绘制时四边形左上角 = `(x + offsetX, y + offsetY)`，其中
   *   `offsetX = inkLeft - PAD`、`offsetY = inkTop - PAD`。
   */
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
    const hasActual = typeof m.actualBoundingBoxLeft === "number";
    // 墨迹包围盒（相对对齐点/基线）
    const bboxLeft = hasActual ? m.actualBoundingBoxLeft : 0;
    const bboxRight = hasActual ? m.actualBoundingBoxRight : m.width;
    const ascent = hasActual ? Math.max(1, m.actualBoundingBoxAscent) : Math.ceil(parseFloat(font) * 0.8 || 20);
    const descent = hasActual ? Math.max(1, m.actualBoundingBoxDescent) : Math.ceil(parseFloat(font) * 0.2 || 5);
    // 墨迹边界相对对齐点：inkLeft 向右为正（= −bboxLeft），inkTop 向上为负（= −ascent）
    const inkLeft = -bboxLeft;
    const inkTop = -ascent;
    const w = Math.max(1, Math.ceil(bboxRight + inkLeft) + PAD * 2);
    const h = Math.max(1, Math.ceil(ascent + descent) + PAD * 2);
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (!g) throw new Error("[unidraw] 无法创建 2d 画布");
    g.font = font;
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#ffffff";
    g.fillText(text, PAD - inkLeft, PAD - inkTop);

    const image = g.getImageData(0, 0, w, h);
    const texture = this.device.createTexture({
      label: `text:${text.slice(0, 12)}`,
      width: w,
      height: h,
      format: "rgba8unorm",
      usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST,
    });
    texture.upload(image.data);
    return { texture, width: w, height: h, offsetX: inkLeft - PAD, offsetY: inkTop - PAD };
  }

  clear(): void {
    for (const g of this.cache.values()) g.texture.destroy();
    this.cache.clear();
  }
}
