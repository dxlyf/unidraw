import type { GeometryData } from "../Geometry.js";
import { ensureOutwardWinding } from "./lathe.js";


/** 平面（XY 平面，法线 +Z），可选细分段与 UV 重复次数。 */
export function plane(width = 1, height = 1, segmentsX = 1, segmentsY = 1, tilesX = 1, tilesY = 1): GeometryData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const rows = segmentsY + 1;
  const cols = segmentsX + 1;
  for (let r = 0; r < rows; r++) {
    const v = r / segmentsY;
    for (let c = 0; c < cols; c++) {
      const u = c / segmentsX;
      positions.push((u - 0.5) * width, (v - 0.5) * height, 0);
      normals.push(0, 0, 1);
      uvs.push(u * tilesX, (1 - v) * tilesY);
    }
  }
  const at = (r: number, c: number) => r * cols + c;
  for (let r = 0; r < segmentsY; r++) {
    for (let c = 0; c < segmentsX; c++) {
      indices.push(at(r, c), at(r + 1, c), at(r + 1, c + 1), at(r, c), at(r + 1, c + 1), at(r, c + 1));
    }
  }
  const data: GeometryData = { positions, normals, uvs, indices };
  ensureOutwardWinding(data);
  return data;
}
