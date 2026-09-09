/**
 * 内置几何体生成器：返回 GeometryData（CPU 侧），
 * 之后用 Geometry.create(device, data) 上传。
 */

import type { GeometryData } from "./Geometry.js";

type Axis = "x" | "y" | "z";

// ---------------------------------------------------------------------------
// 基础：轴向面 / 立方体
// ---------------------------------------------------------------------------

function quadFace(
  axis: Axis,
  sign: 1 | -1,
  w: number,
  h: number,
  positions: number[],
  normals: number[],
  uvs: number[],
): number[] {
  const halfW = w / 2;
  const halfH = h / 2;
  const corners: [number, number, number][] =
    axis === "x"
      ? [
          [0, -halfH, -halfW],
          [0, halfH, -halfW],
          [0, halfH, halfW],
          [0, -halfH, halfW],
        ]
      : axis === "y"
        ? [
            [-halfW, 0, -halfH],
            [halfW, 0, -halfH],
            [halfW, 0, halfH],
            [-halfW, 0, halfH],
          ]
        : [
            [-halfW, -halfH, 0],
            [halfW, -halfH, 0],
            [halfW, halfH, 0],
            [-halfW, halfH, 0],
          ];
  const outward: [number, number, number] =
    axis === "x" ? [sign, 0, 0] : axis === "y" ? [0, sign, 0] : [0, 0, sign];
  const p0 = corners[0]!;
  const p1 = corners[1]!;
  const p2 = corners[2]!;
  const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const dot = cross[0] * outward[0] + cross[1] * outward[1] + cross[2] * outward[2];
  const flip = dot < 0;

  const base = positions.length / 3;
  for (let i = 0; i < 4; i++) {
    const [cx, cy, cz] = corners[i]!;
    positions.push(cx, cy, cz);
    normals.push(outward[0], outward[1], outward[2]);
    const u = i === 0 || i === 3 ? 0 : 1;
    const v = i === 0 || i === 1 ? 0 : 1;
    uvs.push(u, 1 - v);
  }
  if (!flip) {
    return [base, base + 1, base + 2, base, base + 2, base + 3];
  }
  return [base, base + 3, base + 2, base, base + 2, base + 1];
}

/** 立方体：宽/高/深。 */
export function box(width = 1, height = 1, depth = 1): GeometryData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const faces: [axis: Axis, sign: 1 | -1, w: number, h: number][] = [
    ["x", 1, depth, height],
    ["x", -1, depth, height],
    ["y", 1, width, depth],
    ["y", -1, width, depth],
    ["z", 1, width, height],
    ["z", -1, width, height],
  ];
  for (const [axis, sign, w, h] of faces) {
    indices.push(...quadFace(axis, sign, w, h, positions, normals, uvs));
  }
  return { positions, normals, uvs, indices };
}

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

// ---------------------------------------------------------------------------
// 通用：绕序修正（按“顶点法线朝外”翻转三角形）
// ---------------------------------------------------------------------------

function ensureOutwardWinding(data: GeometryData): void {
  if (!data.indices) return;
  const idx = data.indices as unknown as number[]; // 内部由生成器提供可变数组
  const p = data.positions;
  const n = data.normals ?? [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]! * 3;
    const b = idx[i + 1]! * 3;
    const c = idx[i + 2]! * 3;
    const abx = p[b]! - p[a]!;
    const aby = p[b + 1]! - p[a + 1]!;
    const abz = p[b + 2]! - p[a + 2]!;
    const acx = p[c]! - p[a]!;
    const acy = p[c + 1]! - p[a + 1]!;
    const acz = p[c + 2]! - p[a + 2]!;
    let gx = aby * acz - abz * acy;
    let gy = abz * acx - abx * acz;
    let gz = abx * acy - aby * acx;
    const gl = Math.hypot(gx, gy, gz);
    if (gl < 1e-12) continue;
    gx /= gl;
    gy /= gl;
    gz /= gl;
    const nx = n[a]! + n[b]! + n[c]!;
    const ny = n[a + 1]! + n[b + 1]! + n[c + 1]!;
    const nz = n[a + 2]! + n[b + 2]! + n[c + 2]!;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-12) continue;
    if (gx * nx + gy * ny + gz * nz < 0) {
      const tmp = idx[i + 1]!;
      idx[i + 1] = idx[i + 2]!;
      idx[i + 2] = tmp;
    }
  }
}

/** 相邻环带网格（供旋转体/管状体复用） */
function lathe(
  rows: { y: number; r: number; ny: number }[],
  ws: number,
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
): void {
  const rings: number[][] = rows.map(() => []);
  rows.forEach((row, ri) => {
    const lat = Math.asin(Math.max(-1, Math.min(1, row.ny)));
    const cosLat = Math.cos(lat);
    for (let col = 0; col <= ws; col++) {
      const th = (col / ws) * Math.PI * 2;
      const cos = Math.cos(th);
      const sin = Math.sin(th);
      positions.push(row.r * cos, row.y, row.r * sin);
      normals.push(cosLat * cos, row.ny, cosLat * sin);
      uvs.push(col / ws, ri / Math.max(1, rows.length - 1));
      rings[ri]!.push(positions.length / 3 - 1);
    }
  });
  for (let ri = 0; ri < rows.length - 1; ri++) {
    for (let col = 0; col < ws; col++) {
      const a = rings[ri]![col]!;
      const b = rings[ri]![col + 1]!;
      const c = rings[ri + 1]![col]!;
      const d = rings[ri + 1]![col + 1]!;
      indices.push(a, b, d, a, d, c);
    }
  }
}

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
  for (let row = 0; row < hs; row++) {
    for (let col = 0; col < ws; col++) {
      const a = ringOf[row]![col]!;
      const b = ringOf[row]![col + 1]!;
      const c = ringOf[row + 1]![col]!;
      const d = ringOf[row + 1]![col + 1]!;
      sideIdx.push(a, b, c, b, d, c);
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

// ---------------------------------------------------------------------------
// 胶囊（沿 Y：柱段 middle + 两端半径 radius 的半球）
// ---------------------------------------------------------------------------

export function capsule(radius = 0.4, middle = 0.6, radialSegments = 24, capSegments = 8): GeometryData {
  const ws = Math.max(3, radialSegments);
  const cs = Math.max(1, capSegments);
  const half = middle / 2;
  // 从上到下：上顶(φ=π/2)→肩(0)、柱段、肩→下底(φ=-π/2)
  const rows: { y: number; r: number; ny: number }[] = [];
  for (let k = 0; k <= cs; k++) {
    const phi = (Math.PI / 2) * (1 - k / cs);
    rows.push({ y: half + radius * Math.sin(phi), r: radius * Math.cos(phi), ny: Math.sin(phi) });
  }
  const midRows = Math.max(1, cs);
  for (let k = 1; k < midRows; k++) {
    const t = k / midRows;
    rows.push({ y: half - middle * t, r: radius, ny: 0 });
  }
  for (let k = 1; k <= cs; k++) {
    const phi = (Math.PI / 2) * (k / cs);
    rows.push({ y: -half - radius * Math.sin(phi), r: radius * Math.cos(phi), ny: -Math.sin(phi) });
  }
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  lathe(rows, ws, positions, normals, uvs, indices);
  const data: GeometryData = { positions, normals, uvs, indices };
  ensureOutwardWinding(data);
  return data;
}
