import type { Axis } from "./types.js";


// ---------------------------------------------------------------------------
// 基础：轴向面 / 立方体
// ---------------------------------------------------------------------------
export function quadFace(
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
