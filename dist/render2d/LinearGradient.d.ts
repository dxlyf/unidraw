import { Color } from "../math/color.js";
import type { GradientStop } from "./color.js";
export declare class LinearGradient {
    readonly kind: "linear";
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    stops: GradientStop[];
    constructor(x0: number, y0: number, x1: number, y1: number);
    addColorStop(offset: number, color: Color | string): this;
}
//# sourceMappingURL=LinearGradient.d.ts.map