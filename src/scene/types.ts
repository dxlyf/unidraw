/**
 * 渲染层与场景层共享的最小接口类型（避免循环依赖）。
 */

import type { Mat4 } from "../math/mat4.js";
import type { Vec3 } from "../math/vec3.js";
import type { Geometry } from "../render/Geometry.js";
import type { RenderPassEncoder } from "../command/encoder.js";
import type { LightsState } from "../render/lights/LightsState.js";
import type { Buffer } from "../device/resources.js";

/**
 * 实例化绘制的数据源（`InstancedMesh` 实现它）。
 *
 * 材质实现 `drawInstanced()` 时：优先用「实例化顶点流 + 一次 draw」，
 * 拿不到实例化管线（自定义顶点着色器）时按矩阵退化成 N 次普通绘制。
 */
export interface InstancedDrawSource {
  /** 要绘制的实例数（可为 0） */
  readonly instanceCount: number;
  /** 实例矩阵顶点缓冲（列主序 float32x4 × 4，stride 64） */
  readonly instanceBuffer: Buffer;
  /** 读取第 i 个实例矩阵（退化绘制路径用） */
  getMatrixAt(index: number, out?: Mat4): Mat4;
}

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
  /**
   * 一次绘制多个实例（可选）。
   *
   * 实现方内部会用 `model × instanceMatrix` 作为每个实例的模型矩阵；
   * 未实现时调用方（`SceneRenderer`）退化成 N 次 `drawGeometry`。
   */
  drawInstanced?(pass: RenderPassEncoder, geometry: Geometry, model: Mat4, source: InstancedDrawSource): void;
}
