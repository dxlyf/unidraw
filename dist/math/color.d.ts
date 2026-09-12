import { Vec4 } from "./vec4.js";
/**
 * RGBA 颜色。分量约定：
 * - 普通写入为直通值（例如从 hex 解析得到 sRGB 字节归一化）；
 * - 需要物理光照时请调用 `toLinear` 再上传 uniform。
 */
export declare class Color extends Vec4 {
    constructor(r?: number, g?: number, b?: number, a?: number);
    get r(): number;
    set r(v: number);
    get g(): number;
    set g(v: number);
    get b(): number;
    set b(v: number);
    get a(): number;
    set a(v: number);
    setRgb(r: number, g: number, b: number): this;
    /** #rrggbb / #rrggbbaa */
    setHex(hex: string): this;
    getHex(): string;
    /** 拷贝自身并转换到线性空间。 */
    toLinear(): Color;
    fromLinear(): this;
    clone(): Color;
}
export declare const Colors: {
    readonly red: () => Color;
    readonly green: () => Color;
    readonly blue: () => Color;
    readonly yellow: () => Color;
    readonly orange: () => Color;
    readonly purple: () => Color;
    readonly cyan: () => Color;
    readonly white: () => Color;
    readonly black: () => Color;
    readonly gray: () => Color;
};
//# sourceMappingURL=color.d.ts.map