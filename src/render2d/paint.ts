import { Color } from "../math/color.js";
import type { GradientStop, RGBA } from "./color.js";
import { LinearGradient } from "./LinearGradient.js";
import { RadialGradient } from "./RadialGradient.js";
import { CanvasPattern } from "./pattern.js";
import { hexColor } from "./color.js";

export type PaintStyle = string | Color | LinearGradient | RadialGradient | CanvasPattern;
export { CanvasPattern };

export function sampleStops(stops: GradientStop[], t: number): RGBA {
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
  // 图案：逐顶点采样没有意义（真实采样在片元里按用户空间 uv 做），
  // 这里只用于「文字图集」等按顶点着色的回退路径 —— 取白色。
  if (style instanceof CanvasPattern) return { r: 1, g: 1, b: 1, a: 1 };
  // radial
  const dist = Math.hypot(x - (style as RadialGradient).cx, y - (style as RadialGradient).cy) / (style as RadialGradient).r;
  return sampleStops((style as RadialGradient).stops, dist);
}
