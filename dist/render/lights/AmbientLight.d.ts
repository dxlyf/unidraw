/**
 * AmbientLight —— 环境光：无方向、无位置，整体抬亮（多个环境光按颜色×强度累加）。
 */
import { Light } from "./Light.js";
import type { LightsState } from "./LightsState.js";
import type { Color } from "../../math/color.js";
export declare class AmbientLight extends Light {
    constructor(color?: Color | string, intensity?: number);
    contribute(state: LightsState): boolean;
}
//# sourceMappingURL=AmbientLight.d.ts.map