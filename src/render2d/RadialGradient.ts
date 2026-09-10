import { Color } from "../math/color.js";
import type { GradientStop } from "./color.js";
import { hexColor } from "./color.js";

export class RadialGradient {
  readonly kind = "radial" as const;
  cx: number;
  cy: number;
  r: number;
  stops: GradientStop[] = [];
  constructor(cx: number, cy: number, r: number) {
    this.cx = cx;
    this.cy = cy;
    this.r = Math.max(1e-4, r);
  }
  addColorStop(offset: number, color: Color | string): this {
    this.stops.push({ offset, color: typeof color === "string" ? hexColor(color) : color.clone() });
    this.stops.sort((a, b) => a.offset - b.offset);
    return this;
  }
}
