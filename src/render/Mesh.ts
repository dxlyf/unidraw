import { Mat4 } from "../math/mat4.js";
import { type Color } from "../math/color.js";
import type { Geometry } from "./Geometry.js";

/** 一个可绘制对象：几何体 + 世界矩阵 + 可选颜色覆盖。 */
export class Mesh {
  readonly geometry: Geometry;
  model = new Mat4();
  color: Color | null = null;

  constructor(geometry: Geometry) {
    this.geometry = geometry;
  }
}
