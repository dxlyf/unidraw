import { Vec4 } from "./vec4.js";

function srgbChannelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearChannelToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/**
 * RGBA 颜色。分量约定：
 * - 普通写入为直通值（例如从 hex 解析得到 sRGB 字节归一化）；
 * - 需要物理光照时请调用 `toLinear` 再上传 uniform。
 */
export class Color extends Vec4 {
  constructor(r = 1, g = 1, b = 1, a = 1) {
    super(r, g, b, a);
  }

  get r(): number {
    return this.x;
  }
  set r(v: number) {
    this.x = v;
  }
  get g(): number {
    return this.y;
  }
  set g(v: number) {
    this.y = v;
  }
  get b(): number {
    return this.z;
  }
  set b(v: number) {
    this.z = v;
  }
  get a(): number {
    return this.w;
  }
  set a(v: number) {
    this.w = v;
  }

  setRgb(r: number, g: number, b: number): this {
    this.x = r;
    this.y = g;
    this.z = b;
    return this;
  }

  /** #rrggbb / #rrggbbaa */
  setHex(hex: string): this {
    let h = hex.replace("#", "");
    if (h.length === 3) {
      h = h[0]!.repeat(2) + h[1]!.repeat(2) + h[2]!.repeat(2);
    }
    if (h.length === 6) h += "ff";
    if (h.length !== 8) throw new Error(`[unidraw] 非法颜色：${hex}`);
    const n = parseInt(h, 16);
    if (!Number.isFinite(n)) throw new Error(`[unidraw] 非法颜色：${hex}`);
    this.x = ((n >> 24) & 255) / 255;
    this.y = ((n >> 16) & 255) / 255;
    this.z = ((n >> 8) & 255) / 255;
    this.w = (n & 255) / 255;
    return this;
  }

  getHex(): string {
    const toByte = (c: number) => Math.round(c * 255);
    return `#${[this.x, this.y, this.z, this.w]
      .map((c) => toByte(c).toString(16).padStart(2, "0"))
      .join("")}`;
  }

  /** 拷贝自身并转换到线性空间。 */
  toLinear(): Color {
    return new Color(srgbChannelToLinear(this.x), srgbChannelToLinear(this.y), srgbChannelToLinear(this.z), this.w);
  }

  fromLinear(): this {
    this.x = linearChannelToSrgb(this.x);
    this.y = linearChannelToSrgb(this.y);
    this.z = linearChannelToSrgb(this.z);
    return this;
  }

  override clone(): Color {
    return new Color(this.x, this.y, this.z, this.w);
  }}

export const Colors = {
  red: () => new Color().setHex("#ff4646"),
  green: () => new Color().setHex("#3dd68c"),
  blue: () => new Color().setHex("#4c8dff"),
  yellow: () => new Color().setHex("#f5c518"),
  orange: () => new Color().setHex("#ff8f3d"),
  purple: () => new Color().setHex("#b07cff"),
  cyan: () => new Color().setHex("#22d3ee"),
  white: () => new Color(1, 1, 1, 1),
  black: () => new Color(0, 0, 0, 1),
  gray: () => new Color(0.55, 0.55, 0.55, 1),
} as const;
