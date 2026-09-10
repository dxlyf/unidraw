import { Color } from "../math/color.js";
import type { GradientStop } from "./color.js";
import { hexColor } from "./color.js";

export class LinearGradient {
  readonly kind = "linear" as const;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  stops: GradientStop[] = [];
  constructor(x0: number, y0: number, x1: number, y1: number) {
    this.x0 = x0;
    this.y0 = y0;
    this.x1 = x1;
    this.y1 = y1;
  }
  addColorStop(offset: number, color: Color | string): this {
    this.stops.push({ offset, color: typeof color === "string" ? hexColor(color) : color.clone() });
    this.stops.sort((a, b) => a.offset - b.offset);
    return this;
  }
}
