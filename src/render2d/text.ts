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

/** `measureText` 返回的度量（字段名与原生 `TextMetrics` 对齐） */
export interface TextMetricsLike {
  /** 前进宽度（原生排版用的宽度，也是 textAlign 对齐的依据） */
  width: number;
  actualBoundingBoxLeft: number;
  actualBoundingBoxRight: number;
  actualBoundingBoxAscent: number;
  actualBoundingBoxDescent: number;
  /** em 盒（字体）上下沿，`textBaseline` 的 top/middle/bottom 用它 */
  fontBoundingBoxAscent: number;
  fontBoundingBoxDescent: number;
}

const MAX_GLYPHS = 96;

/**
 * 把字体串里的 px 字号乘上倍率（`"700 20px system-ui"` → `"700 40px system-ui"`）。
 *
 * 只认 px（框架自己的 `font` 语义也是 px）；解析不出来就原样返回。
 */
function scaleFontSize(font: string, scale: number): string {
  if (scale === 1) return font;
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  if (!m) return font;
  const size = Number.parseFloat(m[1]!);
  if (!Number.isFinite(size)) return font;
  const scaled = Math.max(1, Math.round(size * scale * 100) / 100);
  return font.slice(0, m.index) + `${scaled}px` + font.slice(m.index + m[0].length);
}
/** 图集四周留白（纹素），避免线性采样时采到相邻内容/边界 */
const PAD = 2;

function hasDocument(): boolean {
  return typeof document !== "undefined";
}

export class TextRenderer {
  private readonly device: Device;
  private cache = new Map<string, GlyphInfo>();
  private metricsCache = new Map<string, TextMetricsLike>();
  private measureCtx: CanvasRenderingContext2D | null = null;

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
    while (this.metricsCache.size > MAX_GLYPHS * 2) {
      const first = this.metricsCache.keys().next().value as string | undefined;
      if (first === undefined) break;
      this.metricsCache.delete(first);
    }
  }

  private ctxForMeasure(): CanvasRenderingContext2D {
    if (this.measureCtx) return this.measureCtx;
    if (!hasDocument()) throw new Error("[unidraw] measureText 需要浏览器环境");
    const cv = document.createElement("canvas");
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("[unidraw] 无法创建 2d 画布");
    this.measureCtx = ctx;
    return ctx;
  }

  /** 文字度量（带缓存） */
  measure(text: string, font: string): TextMetricsLike {
    const key = `${font}\u0000${text}`;
    const hit = this.metricsCache.get(key);
    if (hit) return hit;
    const ctx = this.ctxForMeasure();
    ctx.font = font;
    const m = ctx.measureText(text);
    const ascent = m.actualBoundingBoxAscent;
    const descent = m.actualBoundingBoxDescent;
    const metrics: TextMetricsLike = {
      width: m.width,
      actualBoundingBoxLeft: typeof m.actualBoundingBoxLeft === "number" ? m.actualBoundingBoxLeft : 0,
      actualBoundingBoxRight: typeof m.actualBoundingBoxRight === "number" ? m.actualBoundingBoxRight : m.width,
      actualBoundingBoxAscent: typeof ascent === "number" ? ascent : 0,
      actualBoundingBoxDescent: typeof descent === "number" ? descent : 0,
      fontBoundingBoxAscent: typeof m.fontBoundingBoxAscent === "number" ? m.fontBoundingBoxAscent : Number.parseFloat(font) * 0.8 || 20,
      fontBoundingBoxDescent: typeof m.fontBoundingBoxDescent === "number" ? m.fontBoundingBoxDescent : Number.parseFloat(font) * 0.2 || 5,
    };
    this.metricsCache.set(key, metrics);
    this.evictIfNeeded();
    return metrics;
  }

  /** 取字形（命中缓存直接返回，否则栅格化）；`strokeWidth > 0` 时栅格化描边字形 */
  getGlyph(text: string, font: string, strokeWidth = 0, rasterScale = 1): GlyphInfo {
    const scale = Number.isFinite(rasterScale) && rasterScale > 0 ? rasterScale : 1;
    const key = `${font}\u0000${strokeWidth.toFixed(3)}\u0000${scale.toFixed(3)}\u0000${text}`;
    const hit = this.cache.get(key);
    if (hit) {
      // LRU：重新插入到尾部
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const glyph = this.rasterize(text, font, strokeWidth, scale);
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
   *
   * `rasterScale`（默认 1）表示**一个用户单位等于多少设备像素**（`pixelRatio` ×
   * CTM 缩放）：按放大后的字号栅格化、再把返回的尺寸除以倍率，调用方拿到的仍是
   * 用户单位，而纹理与设备像素 1:1 —— 高分屏/放大绘制时字才不糊。
   */
  private rasterize(text: string, font: string, strokeWidth: number, rasterScale: number): GlyphInfo {
    if (!hasDocument()) {
      throw new Error("[unidraw] fillText 需要浏览器环境（依赖 DOM canvas 栅格化字形）");
    }
    const s = rasterScale;
    const deviceFont = scaleFontSize(font, s);
    const deviceStroke = strokeWidth * s;
    const m = this.measure(text, deviceFont);
    // 描边会向外扩 lineWidth/2，图集留白与包围盒都要跟着放大（miter 尖角再多留一点）
    const grow = deviceStroke > 0 ? deviceStroke / 2 + 1 : 0;
    const bboxLeft = m.actualBoundingBoxLeft - grow;
    const bboxRight = m.actualBoundingBoxRight + grow;
    const ascent = Math.max(1, m.actualBoundingBoxAscent) + grow;
    const descent = Math.max(1, m.actualBoundingBoxDescent) + grow;
    const inkLeft = -bboxLeft;
    const inkTop = -ascent;
    const w = Math.max(1, Math.ceil(bboxRight + inkLeft) + PAD * 2);
    const h = Math.max(1, Math.ceil(ascent + descent) + PAD * 2);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (!g) throw new Error("[unidraw] 无法创建 2d 画布");
    g.font = deviceFont;
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.clearRect(0, 0, w, h);
    if (deviceStroke > 0) {
      // 让浏览器自己描边：字形轮廓的描边质量与原生完全一致
      g.strokeStyle = "#ffffff";
      g.lineWidth = deviceStroke;
      g.lineJoin = "round";
      g.lineCap = "round";
      g.strokeText(text, PAD - inkLeft, PAD - inkTop);
    } else {
      g.fillStyle = "#ffffff";
      g.fillText(text, PAD - inkLeft, PAD - inkTop);
    }

    const image = g.getImageData(0, 0, w, h);
    const texture = this.device.createTexture({
      label: `text:${text.slice(0, 12)}`,
      width: w,
      height: h,
      format: "rgba8unorm",
      usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST,
    });
    texture.upload(image.data);
    // 尺寸/偏移换回**用户单位**（调用方的四边形仍按逻辑像素写）
    return {
      texture,
      width: w / s,
      height: h / s,
      offsetX: (inkLeft - PAD) / s,
      offsetY: (inkTop - PAD) / s,
    };
  }

  clear(): void {
    for (const g of this.cache.values()) g.texture.destroy();
    this.cache.clear();
  }
}
