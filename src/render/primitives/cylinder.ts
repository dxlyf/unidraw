import type { GeometryData } from "../Geometry.js";
import { ensureOutwardWinding } from "./lathe.js";


// ---------------------------------------------------------------------------
// 圆柱 / 圆台 / 圆锥（Y 轴，-height/2..height/2）
// ---------------------------------------------------------------------------

/** radiusTop=0 即圆锥；openEnded 可去掉上下盖。 */
export function cylinder(radiusTop = 0.5, radiusBottom = 0.5, height = 1, radialSegments = 32, heightSegments = 1, openEnded = false): GeometryData {
  const ws = Math.max(3, radialSegments);
  const hs = Math.max(1, heightSegments);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // 侧面生成：每行一个环带，法线含锥台斜率
  const sidePos: number[] = [];
  const sideNrm: number[] = [];
  const sideUv: number[] = [];
  const sideIdx: number[] = [];
  const ringOf: number[][] = [];
  for (let row = 0; row <= hs; row++) {
    const t = row / hs;
    const y = -height / 2 + height * t;
    const r = radiusBottom + (radiusTop - radiusBottom) * t;
    const drift = radiusTop - radiusBottom;
    const ring: number[] = [];
    for (let col = 0; col <= ws; col++) {
      const th = (col / ws) * Math.PI * 2;
      const cos = Math.cos(th);
      const sin = Math.sin(th);
      sidePos.push(r * cos, y, r * sin);
      let nx = height * cos;
      let ny = -drift;
      let nz = height * sin;
      const l = Math.hypot(nx, ny, nz);
      if (l > 1e-9) {
        nx /= l;
        ny /= l;
        nz /= l;
      }
      if (nx * cos + nz * sin < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      sideNrm.push(nx, ny, nz);
      sideUv.push(col / ws, row / hs);
      ring.push(sidePos.length / 3 - 1);
    }
    ringOf.push(ring);
  }
  // 侧面：半径 ≈ 0 的行是极点（圆锥顶点），改用扇形三角形，避免退化四边形
  const POLE_EPS = 1e-6;
  const bottomIsPole = radiusBottom <= POLE_EPS;
  const topIsPole = radiusTop <= POLE_EPS;
  for (let row = 0; row < hs; row++) {
    const thisIsPole = bottomIsPole && row === 0;
    const nextIsPole = topIsPole && row === hs - 1;
    if (thisIsPole && nextIsPole) continue;
    for (let col = 0; col < ws; col++) {
      const a = ringOf[row]![col]!;
      const b = ringOf[row]![col + 1]!;
      const c = ringOf[row + 1]![col]!;
      const d = ringOf[row + 1]![col + 1]!;
      if (thisIsPole) sideIdx.push(b, d, c);
      else if (nextIsPole) sideIdx.push(a, b, c);
      else sideIdx.push(a, b, c, b, d, c);
    }
  }
  positions.push(...sidePos);
  normals.push(...sideNrm);
  uvs.push(...sideUv);
  indices.push(...sideIdx);

  // 端盖
  const addDisk = (y: number, radius: number, up: 1 | -1) => {
    if (radius <= 1e-6) return;
    const center = positions.length / 3;
    positions.push(0, y, 0);
    normals.push(0, up, 0);
    uvs.push(0.5, 0.5);
    const ringStart = positions.length / 3;
    for (let col = 0; col < ws; col++) {
      const th = (col / ws) * Math.PI * 2;
      positions.push(radius * Math.cos(th), y, radius * Math.sin(th));
      normals.push(0, up, 0);
      uvs.push(0.5 + 0.5 * Math.cos(th), 0.5 + 0.5 * Math.sin(th));
    }
    for (let col = 0; col < ws; col++) {
      const next = ringStart + ((col + 1) % ws);
      if (up === 1) indices.push(center, ringStart + col, next);
      else indices.push(center, next, ringStart + col);
    }
  };
  if (!openEnded) {
    addDisk(height / 2, radiusTop, 1);
    addDisk(-height / 2, radiusBottom, -1);
  }
  const data: GeometryData = { positions, normals, uvs, indices };
  ensureOutwardWinding(data);
  return data;
}


/** 圆锥（顶点朝上 +Y） */
export function cone(radius = 0.5, height = 1, radialSegments = 32): GeometryData {
  return cylinder(0, radius, height, radialSegments, 1, false);
}
