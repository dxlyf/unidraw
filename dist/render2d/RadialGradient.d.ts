import { Color } from "../math/color.js";
import type { GradientStop } from "./color.js";
export declare class RadialGradient {
    readonly kind: "radial";
    cx: number;
    cy: number;
    r: number;
    stops: GradientStop[];
    constructor(cx: number, cy: number, r: number);
    addColorStop(offset: number, color: Color | string): this;
}
//# sourceMappingURL=RadialGradient.d.ts.map