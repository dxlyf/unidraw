import type { GeometryData } from "../Geometry.js";
import { ensureOutwardWinding } from "./lathe.js";


/**
 * 球体（UV 球）。
 *
 * 极点处理：第 0 行与第 hs 行的 ws+1 个顶点**位置相同**（都在极点），
 * 因此极点与相邻环之间必须用「极点 + 环上相邻两点」的扇形三角形连接；
 * 若照搬中间环带的四边形，极点那一侧会出现两个重合顶点 → 零面积三角形 →
 * 盖上没有三角形 → 上下各留一个洞。
 */
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
    const topPole = r === 0;
    const bottomPole = r === hs - 1;
    for (let c = 0; c < ws; c++) {
      const a = at(r, c);
      const b = at(r, c + 1);
      const cc = at(r + 1, c);
      const d = at(r + 1, c + 1);
      if (topPole) {
        // 顶极点扇：a 与 b 重合于极点，只连「极点 + 环上两点」
        indices.push(a, d, cc);
      } else if (bottomPole) {
        // 底极点扇：cc 与 d 重合于极点
        indices.push(a, b, cc);
      } else {
        indices.push(a, b, cc, b, d, cc);
      }
    }
  }
  const data: GeometryData = { positions, normals, uvs, indices };
  // 法线就是单位位置向量，用它校正绕序是很可靠的
  ensureOutwardWinding(data);
  return data;
}
