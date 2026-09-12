import { Color } from "../math/color.js";
import type { GradientStop, RGBA } from "./color.js";
import { LinearGradient } from "./LinearGradient.js";
import { RadialGradient } from "./RadialGradient.js";
import { CanvasPattern } from "./pattern.js";
export type PaintStyle = string | Color | LinearGradient | RadialGradient | CanvasPattern;
export { CanvasPattern };
export declare function sampleStops(stops: GradientStop[], t: number): RGBA;
/** 解析样式在用户坐标 (x,y) 处的颜色 */
export declare function sampleStyle(style: PaintStyle, x: number, y: number): RGBA;
//# sourceMappingURL=paint.d.ts.map