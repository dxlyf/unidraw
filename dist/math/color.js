import { Vec4 } from "./vec4.js";
function srgbChannelToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearChannelToSrgb(c) {
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
    get r() {
        return this.x;
    }
    set r(v) {
        this.x = v;
    }
    get g() {
        return this.y;
    }
    set g(v) {
        this.y = v;
    }
    get b() {
        return this.z;
    }
    set b(v) {
        this.z = v;
    }
    get a() {
        return this.w;
    }
    set a(v) {
        this.w = v;
    }
    setRgb(r, g, b) {
        this.x = r;
        this.y = g;
        this.z = b;
        return this;
    }
    /** #rrggbb / #rrggbbaa */
    setHex(hex) {
        let h = hex.replace("#", "");
        if (h.length === 3) {
            h = h[0].repeat(2) + h[1].repeat(2) + h[2].repeat(2);
        }
        if (h.length === 6)
            h += "ff";
        if (h.length !== 8)
            throw new Error(`[unidraw] 非法颜色：${hex}`);
        const n = parseInt(h, 16);
        if (!Number.isFinite(n))
            throw new Error(`[unidraw] 非法颜色：${hex}`);
        this.x = ((n >> 24) & 255) / 255;
        this.y = ((n >> 16) & 255) / 255;
        this.z = ((n >> 8) & 255) / 255;
        this.w = (n & 255) / 255;
        return this;
    }
    getHex() {
        const toByte = (c) => Math.round(c * 255);
        return `#${[this.x, this.y, this.z, this.w]
            .map((c) => toByte(c).toString(16).padStart(2, "0"))
            .join("")}`;
    }
    /** 拷贝自身并转换到线性空间。 */
    toLinear() {
        return new Color(srgbChannelToLinear(this.x), srgbChannelToLinear(this.y), srgbChannelToLinear(this.z), this.w);
    }
    fromLinear() {
        this.x = linearChannelToSrgb(this.x);
        this.y = linearChannelToSrgb(this.y);
        this.z = linearChannelToSrgb(this.z);
        return this;
    }
    clone() {
        return new Color(this.x, this.y, this.z, this.w);
    }
}
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
};
//# sourceMappingURL=color.js.map