import type { GeometryData } from "../Geometry.js";
import { ensureOutwardWinding } from "./lathe.js";


// ---------------------------------------------------------------------------
// 圆环
// ---------------------------------------------------------------------------
export function torus(radius = 0.6, tube = 0.2, radialSegments = 32, tubularSegments = 16): GeometryData {
  const ws = Math.max(3, radialSegments);
  const ts = Math.max(3, tubularSegments);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= ws; i++) {
    const u = (i / ws) * Math.PI * 2;
    const cu = Math.cos(u);
    const su = Math.sin(u);
    for (let j = 0; j <= ts; j++) {
      const v = (j / ts) * Math.PI * 2;
      const cv = Math.cos(v);
      const sv = Math.sin(v);
      positions.push((radius + tube * cv) * cu, tube * sv, (radius + tube * cv) * su);
      normals.push(cv * cu, sv, cv * su);
      uvs.push(i / ws, j / ts);
    }
  }
  const stride = ts + 1;
  for (let i = 0; i < ws; i++) {
    for (let j = 0; j < ts; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = (i + 1) * stride + j;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }
  const data: GeometryData = { positions, normals, uvs, indices };
  ensureOutwardWinding(data);
  return data;
}
