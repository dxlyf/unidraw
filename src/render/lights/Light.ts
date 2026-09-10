/**
 * Light —— 灯光节点的基类。
 *
 * 灯是**场景图里的普通节点**（继承 Node3D），因此可以挂在任意父节点下：
 * 点光/聚光用节点的**世界位置**，方向光/聚光用显式的 `direction`（世界空间）。
 * 每帧由 `SceneRenderer` 收集并打包进 `LightsBlock`（见 lights/LightsState.ts）。
 */

import { Node3D } from "../../scene/Node3D.js";
import { Color } from "../../math/color.js";

let nextLightId = 1;

export abstract class Light extends Node3D {
  readonly lightId: number = nextLightId++;
  /** 光颜色（线性 RGB，0..1） */
  readonly color: Color;
  /** 强度（与颜色相乘） */
  intensity: number;

  protected constructor(color: Color = new Color(1, 1, 1, 1), intensity = 1) {
    super();
    this.color = color.clone();
    this.intensity = intensity;
  }

  /** 设置颜色（十六进制字符串或 Color） */
  setColor(color: Color | string): this {
    if (typeof color === "string") this.color.setHex(color);
    else this.color.copy(color);
    return this;
  }

  setIntensity(intensity: number): this {
    this.intensity = intensity;
    return this;
  }

  /** 累加进 `LightsState`（由收集器调用；返回是否写入成功） */
  abstract contribute(state: import("./LightsState.js").LightsState): boolean;
}
