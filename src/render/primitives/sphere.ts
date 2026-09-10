import type { GeometryData } from "../Geometry.js";


/** 球体。 */
export function sphere(radius = 0.5, widthSegments = 24, heightSegments = 12): GeometryData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ws = Math.max(3, widthSegments);
  const hs = Math.max(2, heightSegments);
  const at = (r: number, c: number) => r * (ws + 1) + c;
  for (let r = 0; r <= hs; r++) {
    const theta = (r / hs) * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let c = 0; c <= ws; c++) {
      const phi = (c / ws) * Math.PI * 2;
      const x = radius * sinT * Math.cos(phi);
      const y = radius * cosT;
      const z = radius * sinT * Math.sin(phi);
      positions.push(x, y, z);
      normals.push(x / radius, y / radius, z / radius);
      uvs.push(c / ws, r / hs);
    }
  }
  for (let r = 0; r < hs; r++) {
    for (let c = 0; c < ws; c++) {
      const a = at(r, c);
      const b = at(r, c + 1);
      const cc = at(r + 1, c);
      const d = at(r + 1, c + 1);
      if (r === 0) indices.push(a, d, b);
      else if (r === hs - 1) indices.push(a, cc, d);
      else indices.push(a, b, cc, b, d, cc);
    }
  }
  return { positions, normals, uvs, indices };
}
