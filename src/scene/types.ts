/**
 * 渲染层与场景层共享的最小接口类型（避免循环依赖）。
 */

import type { Mat4 } from "../math/mat4.js";
import type { Geometry } from "../render/Geometry.js";
import type { RenderPassEncoder } from "../command/encoder.js";

/** 材质只需满足“能用给定模型矩阵把几何体画出来” */
export interface MaterialLike {
  /** 是否半透明（影响排序：不透明近→远，透明远→近） */
  readonly isTransparent?: boolean;
  drawGeometry(pass: RenderPassEncoder, geometry: Geometry, model: Mat4): void;
}
