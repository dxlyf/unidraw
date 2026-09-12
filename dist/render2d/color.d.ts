import { Color } from "../math/color.js";
export interface GradientStop {
    offset: number;
    color: Color;
}
export declare function hexColor(hex: string): Color;
export interface RGBA {
    r: number;
    g: number;
    b: number;
    a: number;
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
export declare function cssColorRgba(color: string): RGBA | null;
//# sourceMappingURL=color.d.ts.map