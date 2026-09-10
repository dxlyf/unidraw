/**
 * 渲染层与场景层共享的最小接口类型（避免循环依赖）。
 */

import type { Mat4 } from "../math/mat4.js";
import type { Vec3 } from "../math/vec3.js";
import type { Geometry } from "../render/Geometry.js";
import type { RenderPassEncoder } from "../command/encoder.js";
import type { LightsState } from "../render/lights/LightsState.js";

/** 材质只需满足“能用给定模型矩阵把几何体画出来” */
export interface MaterialLike {
  /** 是否半透明（影响排序：不透明近→远，透明远→近） */
  readonly isTransparent?: boolean;
  /**
   * 每个 pass 把相机与灯光喂给材质（内置材质写 `u_viewProj` / `u_cameraPos` / `LightsBlock`）。
   *
   * `SceneRenderer.render()` 会在绘制前对场景里用到的每个材质自动调用一次
   * （灯光由它从场景图收集）；因此直接用 `App`（或 `SceneRenderer`）渲染时**不需要**
   * 手工遍历材质。自己组织 pass（如拾取/阴影）时仍可手动调用，此时可省略 `lights`
   * （材质会退化为默认光）。
   */
  beginFrame?(viewProjection: Mat4, cameraPos?: Vec3, lights?: LightsState): void;
  drawGeometry(pass: RenderPassEncoder, geometry: Geometry, model: Mat4): void;
}
