import type { GeometryData } from "../Geometry.js";


/** 单个三角形（法线 +Z），用于最小示例。 */
export function triangle(): GeometryData {
  return {
    positions: [0, 0.7, 0, -0.7, -0.5, 0, 0.7, -0.5, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    uvs: [0.5, 0, 0, 1, 1, 1],
  };
}


/** 屏幕空间全屏三角形（供后处理采样使用，无索引）。 */
export function fullscreenTriangle(): GeometryData {
  return {
    positions: [-1, -1, 0, 3, -1, 0, -1, 3, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    uvs: [0, 1, 2, 1, 0, -1],
  };
}
