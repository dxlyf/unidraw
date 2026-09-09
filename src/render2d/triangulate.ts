/**
 * 简单多边形三角化：凸多边形直接 fan；一般（含凹）多边形用耳切。
 * 输入任意绕序；输出三角形三个顶点在原点数组中的下标（连续三元组）。
 */

import type { Pt2 } from "./matrix.js";

/** 两倍有向面积（shoelace），正负表示绕序 */
export function polygonArea2(pts: Pt2[]): number {
  let s = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
}

function cross2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** 用 ±1 统一绕序后的“左侧”判定 */
function pointInTri(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, sign: number): boolean {
  const d1 = sign * cross2(ax, ay, bx, by, px, py);
  const d2 = sign * cross2(bx, by, cx, cy, px, py);
  const d3 = sign * cross2(cx, cy, ax, ay, px, py);
  return d1 > 1e-9 && d2 > 1e-9 && d3 > 1e-9;
}

/**
 * 三角化简单多边形。返回下标三元组数组；失败返回 null（退化/自交过多）。
 */
export function triangulateSimplePolygon(pts: Pt2[]): number[] | null {
  const n = pts.length;
  if (n < 3) return null;
  const area = polygonArea2(pts);
  if (Math.abs(area) < 1e-9) return null;
  const sign = area > 0 ? 1 : -1;
  if (n === 3) return [0, 1, 2];

  // 去重相邻重复点（保持原下标映射：用原下标列表）
  const ring: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!;
    const cur = pts[i]!;
    const dup = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) < 1e-9;
    if (!dup) ring.push(i);
  }
  if (ring.length < 3) return null;

  const tris: number[] = [];
  let guard = n * n;
  while (ring.length > 3) {
    if (--guard < 0) break; // 病态输入兜底
    let clipped = false;
    const m = ring.length;
    for (let k = 0; k < m && !clipped; k++) {
      const i = ring[k]!;
      const ip = ring[(k - 1 + m) % m]!;
      const inx = ring[(k + 1) % m]!;
      const a = pts[ip]!;
      const b = pts[i]!;
      const c = pts[inx]!;
      if (sign * cross2(a[0], a[1], b[0], b[1], c[0], c[1]) < 1e-9) continue; // 非凸耳
      let empty = true;
      for (const j of ring) {
        if (j === ip || j === i || j === inx) continue;
        const q = pts[j]!;
        if (pointInTri(q[0], q[1], a[0], a[1], b[0], b[1], c[0], c[1], sign)) {
          empty = false;
          break;
        }
      }
      if (!empty) continue;
      tris.push(ip, i, inx);
      ring.splice(k, 1);
      clipped = true;
    }
    if (!clipped) break; // 未能裁剪（数值奇异）
  }
  if (ring.length === 3) tris.push(ring[0]!, ring[1]!, ring[2]!);
  else if (ring.length > 3) {
    // 兜底：扇形
    const a = ring[0]!;
    for (let k = 1; k + 1 < ring.length; k++) tris.push(a, ring[k]!, ring[k + 1]!);
  }
  return tris.length >= 3 ? tris : null;
}
