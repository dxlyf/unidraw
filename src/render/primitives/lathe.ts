import type { GeometryData } from "../Geometry.js";


// ---------------------------------------------------------------------------
// 通用：绕序修正（按“顶点法线朝外”翻转三角形）
// ---------------------------------------------------------------------------
export function ensureOutwardWinding(data: GeometryData): void {
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
export function lathe(
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
