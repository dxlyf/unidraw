/**
 * Light —— 灯光节点的基类。
 *
 * 灯是**场景图里的普通节点**（继承 Node3D），因此可以挂在任意父节点下：
 * 点光/聚光用节点的**世界位置**，方向光/聚光用显式的 `direction`（世界空间）。
 * 每帧由 `SceneRenderer` 收集并打包进 `LightsBlock`（见 lights/LightsState.ts）。
 */
import { Node3D } from "../../scene/Node3D.js";
import { Color } from "../../math/color.js";
import { ShadowSettings, type ShadowOptions } from "../shadow/ShadowSettings.js";
export declare abstract class Light extends Node3D {
    readonly lightId: number;
    /** 光颜色（线性 RGB，0..1） */
    readonly color: Color;
    /** 强度（与颜色相乘） */
    intensity: number;
    /**
     * 是否投射阴影（默认 false）。
     *
     * 打开后需要 `SceneRenderer` 侧配套一个 `ShadowRenderer`（或 `App` 的阴影选项）
     * 来渲染阴影贴图；只设 `castShadow` 而不渲染阴影 pass 不会有任何效果。
     * 目前支持**方向光**与**聚光**（一次着色最多 `MAX_SHADOW_MAPS` 张，点光不支持）。
     */
    castShadow: boolean;
    /** 阴影参数（`castShadow = true` 后生效） */
    readonly shadow: ShadowSettings;
    protected constructor(color?: Color, intensity?: number);
    /** 便捷：打开阴影并设置参数（`sun.setShadow({ mapSize: 2048 })`） */
    setShadow(options?: ShadowOptions): this;
    /** 设置颜色（十六进制字符串或 Color） */
    setColor(color: Color | string): this;
    setIntensity(intensity: number): this;
    /** 累加进 `LightsState`（由收集器调用；返回是否写入成功） */
    abstract contribute(state: import("./LightsState.js").LightsState): boolean;
}
//# sourceMappingURL=Light.d.ts.map