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

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

// ---------------------------------------------------------------------------
// CSS 颜色解析（fillStyle / strokeStyle / shadowColor 共用）
// ---------------------------------------------------------------------------

/** 解析缓存：颜色串在热路径上会被反复用到（逐顶点/逐 op），必须只解析一次 */
const cssColorCache = new Map<string, RGBA | null>();
/** 浏览器解析用的 1×1 画布（懒建，全局复用） */
let scratchCtx: CanvasRenderingContext2D | null | undefined;

function colorScratch(): CanvasRenderingContext2D | null {
  if (scratchCtx !== undefined) return scratchCtx;
  if (typeof document === "undefined") {
    scratchCtx = null;
    return null;
  }
  const cv = document.createElement("canvas");
  cv.width = 1;
  cv.height = 1;
  scratchCtx = cv.getContext("2d");
  return scratchCtx;
}

/** `"#rrggbb"` / `"#rgb"` / `"#rrggbbaa"` → RGBA（0..1）；解析不了返回 null */
function parseHexColor(s: string): RGBA | null {
  let h = s.slice(1);
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  else if (h.length === 4) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]! + h[3]! + h[3]!;
  else if (h.length !== 6 && h.length !== 8) return null;
  const n = Number.parseInt(h, 16);
  if (!Number.isFinite(n)) return null;
  const r = (n >> (h.length === 8 ? 24 : 16)) & 255;
  const g = (h.length === 8 ? (n >> 16) : (n >> 8)) & 255;
  const b = (h.length === 8 ? (n >> 8) : n) & 255;
  const a = h.length === 8 ? (n & 255) / 255 : 1;
  return { r: r / 255, g: g / 255, b: b / 255, a };
}

/**
 * 解析 CSS 颜色串 → RGBA（各分量 0..1），解析不了返回 `null`。
 *
 * 优先交给**浏览器自己**解析（`ctx.fillStyle = s` 再读回来，会被规范成
 * `#rrggbb` 或 `rgba(r, g, b, a)`）—— 这样命名色（`"black"`/`"red"`）、
 * `hsl()`、`color(...)` 等全部与原生一致，不用自己维护颜色表。
 * 没有 DOM（Node 测试）时退回 hex / `rgb()` / `rgba()`。
 *
 * 结果按字符串缓存（含 `null` 结果），所以可以放心放在热路径上。
 */
export function cssColorRgba(color: string): RGBA | null {
  const key = color;
  const hit = cssColorCache.get(key);
  if (hit !== undefined) return hit;
  const parsed = parseCssColor(key);
  if (cssColorCache.size > 512) cssColorCache.clear();
  cssColorCache.set(key, parsed);
  return parsed;
}

function parseCssColor(s: string): RGBA | null {
  const t = s.trim();
  if (t === "") return null;
  if (t === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const g = colorScratch();
  if (g) {
    // 先设成已知的哨兵值：非法颜色串时 fillStyle 会保持原值（与原生一致）
    g.fillStyle = "#000000";
    g.fillStyle = t;
    const norm = typeof g.fillStyle === "string" ? g.fillStyle : "";
    const parsed = parseNormalized(norm);
    if (parsed) return parsed;
    // 规范化结果不是 #rrggbb / rgba(...)（理论上不会）→ 交给简单解析兜底
  }
  return parseSimple(s);
}

/** 浏览器规范化后的两种形态 */
function parseNormalized(norm: string): RGBA | null {
  if (norm.startsWith("#")) return parseHexColor(norm);
  const m = /^rgba?\(([^)]+)\)$/i.exec(norm);
  if (!m) return null;
  const parts = m[1]!.split(/[,\s/]+/).filter((v) => v.length > 0);
  return {
    r: clamp01(Number.parseFloat(parts[0] ?? "0") / 255),
    g: clamp01(Number.parseFloat(parts[1] ?? "0") / 255),
    b: clamp01(Number.parseFloat(parts[2] ?? "0") / 255),
    a: parts.length > 3 ? clamp01(Number.parseFloat(parts[3]!)) : 1,
  };
}

/** 无 DOM 时的兜底：hex 与 rgb()/rgba() */
function parseSimple(s: string): RGBA | null {
  if (s.startsWith("#")) return parseHexColor(s);
  const m = /^rgba?\(([^)]+)\)$/i.exec(s.trim());
  if (!m) return null;
  const parts = m[1]!.split(/[,\s/]+/).filter((v) => v.length > 0);
  return {
    r: clamp01(Number.parseFloat(parts[0] ?? "0") / 255),
    g: clamp01(Number.parseFloat(parts[1] ?? "0") / 255),
    b: clamp01(Number.parseFloat(parts[2] ?? "0") / 255),
    a: parts.length > 3 ? clamp01(Number.parseFloat(parts[3]!)) : 1,
  };
}

function clamp01(v: number): number {
  return !Number.isFinite(v) ? 0 : v < 0 ? 0 : v > 1 ? 1 : v;
}
