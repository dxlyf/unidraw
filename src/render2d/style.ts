/**
 * 2D 样式：纯色 / 线性渐变 / 径向渐变（近似采样）。
 * 与 canvas 类似：渐变在“用户空间”采样（绘制时先取色再经 CTM 变换）。
 */

import { Color } from "../math/color.js";

export interface GradientStop {
  offset: number; // 0..1
  color: Color;
}

export function hexColor(hex: string): Color {
  const c = new Color(1, 1, 1, 1);
  if (hex.startsWith("#")) c.setHex(hex);
  else if (hex.startsWith("rgba(")) c.setHex("#ffffff");
  else c.setHex("#" + hex.replace(/^#/, ""));
  return c;
}

export class LinearGradient {
  readonly kind = "linear" as const;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  stops: GradientStop[] = [];
  constructor(x0: number, y0: number, x1: number, y1: number) {
    this.x0 = x0;
    this.y0 = y0;
    this.x1 = x1;
    this.y1 = y1;
  }
  addColorStop(offset: number, color: Color | string): this {
    this.stops.push({ offset, color: typeof color === "string" ? hexColor(color) : color.clone() });
    this.stops.sort((a, b) => a.offset - b.offset);
    return this;
  }
}

export class RadialGradient {
  readonly kind = "radial" as const;
  cx: number;
  cy: number;
  r: number;
  stops: GradientStop[] = [];
  constructor(cx: number, cy: number, r: number) {
    this.cx = cx;
    this.cy = cy;
    this.r = Math.max(1e-4, r);
  }
  addColorStop(offset: number, color: Color | string): this {
    this.stops.push({ offset, color: typeof color === "string" ? hexColor(color) : color.clone() });
    this.stops.sort((a, b) => a.offset - b.offset);
    return this;
  }
}

export type PaintStyle = string | Color | LinearGradient | RadialGradient;

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

function sampleStops(stops: GradientStop[], t: number): RGBA {
  if (stops.length === 0) return { r: 0, g: 0, b: 0, a: 1 };
  let t0 = Math.max(0, Math.min(1, t));
  if (t0 <= stops[0]!.offset) {
    const c = stops[0]!.color;
    return { r: c.r, g: c.g, b: c.b, a: c.a };
  }
  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i]!;
    const s1 = stops[i + 1]!;
    if (t0 >= s0.offset && t0 <= s1.offset) {
      const span = s1.offset - s0.offset || 1;
      const k = (t0 - s0.offset) / span;
      const c0 = s0.color;
      const c1 = s1.color;
      return { r: c0.r + (c1.r - c0.r) * k, g: c0.g + (c1.g - c0.g) * k, b: c0.b + (c1.b - c0.b) * k, a: c0.a + (c1.a - c0.a) * k };
    }
  }
  const c = stops[stops.length - 1]!.color;
  return { r: c.r, g: c.g, b: c.b, a: c.a };
}

/** 解析样式在用户坐标 (x,y) 处的颜色 */
export function sampleStyle(style: PaintStyle, x: number, y: number): RGBA {
  if (typeof style === "string") {
    const c = hexColor(style);
    return { r: c.r, g: c.g, b: c.b, a: c.a };
  }
  if (style instanceof Color) return { r: style.r, g: style.g, b: style.b, a: style.a };
  if (style instanceof LinearGradient) {
    const dx = style.x1 - style.x0;
    const dy = style.y1 - style.y0;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 1e-12 ? ((x - style.x0) * dx + (y - style.y0) * dy) / len2 : 0;
    return sampleStops(style.stops, t);
  }
  // radial（近似：在三角化顶点采样，配合细分可获得平滑结果）
  const dist = Math.hypot(x - style.cx, y - style.cy) / style.r;
  return sampleStops(style.stops, dist);
}
