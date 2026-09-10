/**
 * AmbientLight —— 环境光：无方向、无位置，整体抬亮（多个环境光按颜色×强度累加）。
 */

import { Light } from "./Light.js";
import type { LightsState } from "./LightsState.js";
import type { Color } from "../../math/color.js";

export class AmbientLight extends Light {
  constructor(color?: Color | string, intensity = 1) {
    super(typeof color === "string" ? undefined : color, intensity);
    if (typeof color === "string") this.color.setHex(color);
  }

  contribute(state: LightsState): boolean {
    state.addAmbient(this.color, this.intensity);
    return true;
  }
}
