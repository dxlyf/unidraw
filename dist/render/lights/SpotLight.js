/**
 * SpotLight —— 聚光：位置 = 节点世界位置，方向显式给出（世界空间），带锥角与半影。
 *
 * - `angle`：外锥半角（弧度），缺省 π/6（30°）；
 * - `penumbra`：0 = 硬边、1 = 从中心就开始软化；
 * - `distance`/`decay`：与点光相同的距离衰减；
 * - 锥内权重：`smoothstep(cosInner, cosOuter, dot(-L, direction))`，
 *   其中 `cosInner = cos(angle·(1-penumbra))`（在 CPU 侧预先算好，shader 里不出现 acos）。
 */
import { Light } from "./Light.js";
import { Vec3 } from "../../math/vec3.js";
export class SpotLight extends Light {
    /** 光传播方向（世界空间，内部归一化） */
    direction = new Vec3(0, -1, 0);
    /** 外锥半角（弧度） */
    angle = Math.PI / 6;
    /** 半影：0 硬边 ~ 1 全软 */
    penumbra = 0.25;
    /** 影响距离（0 = 无限） */
    distance = 0;
    /** 衰减指数 */
    decay = 2;
    _world = new Vec3();
    constructor(color, intensity = 1) {
        super(typeof color === "string" ? undefined : color, intensity);
        if (typeof color === "string")
            this.color.setHex(color);
    }
    setDirection(x, y, z) {
        this.direction.set(x, y, z);
        return this;
    }
    setAngle(angleRad, penumbra = this.penumbra) {
        this.angle = angleRad;
        this.penumbra = penumbra;
        return this;
    }
    contribute(state) {
        this.getWorldPosition(this._world);
        return state.addSpot(this._world, this.direction, this.color, this.intensity, this.distance, this.angle, this.penumbra);
    }
}
//# sourceMappingURL=SpotLight.js.map