/**
 * PointLight —— 点光：位置 = 节点的世界位置，按距离衰减。
 *
 * 衰减公式（fragment 内）：
 * ```
 * d = distance(worldPos, lightPos)
 * atten = 1 / max(d, 1e-4)^decay                       // decay 默认 2（平方反比）
 * if (range > 0) atten *= smoothstep-window(1 - (d/range)^4)²  // 平滑截断
 * ```
 * 挂在移动的父节点下（或自身用动画驱动）就能得到移动光源。
 */
import { Light } from "./Light.js";
import { Vec3 } from "../../math/vec3.js";
import type { LightsState } from "./LightsState.js";
import type { Color } from "../../math/color.js";
export declare class PointLight extends Light {
    /** 影响距离（0 = 无限，仅按 decay 衰减） */
    distance: number;
    /** 衰减指数（2 = 物理平方反比；1 = 线性感） */
    decay: number;
    private readonly _world;
    constructor(color?: Color | string, intensity?: number, distance?: number, decay?: number);
    /** 世界位置（需要 worldMatrix 已更新） */
    getWorldPosition2(out?: Vec3): Vec3;
    contribute(state: LightsState): boolean;
}
//# sourceMappingURL=PointLight.d.ts.map