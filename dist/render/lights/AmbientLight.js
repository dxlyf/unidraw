/**
 * AmbientLight —— 环境光：无方向、无位置，整体抬亮（多个环境光按颜色×强度累加）。
 */
import { Light } from "./Light.js";
export class AmbientLight extends Light {
    constructor(color, intensity = 1) {
        super(typeof color === "string" ? undefined : color, intensity);
        if (typeof color === "string")
            this.color.setHex(color);
    }
    contribute(state) {
        state.addAmbient(this.color, this.intensity);
        return true;
    }
}
//# sourceMappingURL=AmbientLight.js.map