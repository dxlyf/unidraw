import { hexColor } from "./color.js";
export class LinearGradient {
    kind = "linear";
    x0;
    y0;
    x1;
    y1;
    stops = [];
    constructor(x0, y0, x1, y1) {
        this.x0 = x0;
        this.y0 = y0;
        this.x1 = x1;
        this.y1 = y1;
    }
    addColorStop(offset, color) {
        this.stops.push({ offset, color: typeof color === "string" ? hexColor(color) : color.clone() });
        this.stops.sort((a, b) => a.offset - b.offset);
        return this;
    }
}
//# sourceMappingURL=LinearGradient.js.map