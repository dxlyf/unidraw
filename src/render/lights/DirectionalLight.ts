/**
 * DirectionalLight —— 平行光（太阳）：只有方向，位置不影响结果。
 *
 * `direction` 是**光的传播方向**（从光源射向场景，世界空间），缺省 (0,-1,0)（自上而下）。
 * 想表达「太阳在左上方」就写 `new Vec3(0.35, -0.75, -0.55)`（等价于老 shader 的
 * `lightDir = (0.35,0.75,0.55)` 指向光源的写法取反）。
 */

import { Light } from "./Light.js";
import { Vec3 } from "../../math/vec3.js";
import type { LightsState } from "./LightsState.js";
import type { Color } from "../../math/color.js";

export class DirectionalLight extends Light {
  /** 光传播方向（世界空间，内部归一化） */
  readonly direction = new Vec3(0, -1, 0);

  constructor(direction?: Vec3, color?: Color | string, intensity = 1) {
    super(typeof color === "string" ? undefined : color, intensity);
    if (typeof color === "string") this.color.setHex(color);
    if (direction) this.direction.copy(direction);
  }

  setDirection(x: number, y: number, z: number): this {
    this.direction.set(x, y, z);
    return this;
  }

  contribute(state: LightsState): boolean {
    return state.addDirectional(this.direction, this.color, this.intensity);
  }
}
