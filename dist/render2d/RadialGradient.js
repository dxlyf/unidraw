import { hexColor } from "./color.js";
export class RadialGradient {
    kind = "radial";
    cx;
    cy;
    r;
    stops = [];
    constructor(cx, cy, r) {
        this.cx = cx;
        this.cy = cy;
        this.r = Math.max(1e-4, r);
    }
    addColorStop(offset, color) {
        this.stops.push({ offset, color: typeof color === "string" ? hexColor(color) : color.clone() });
        this.stops.sort((a, b) => a.offset - b.offset);
        return this;
    }
}
//# sourceMappingURL=RadialGradient.js.map