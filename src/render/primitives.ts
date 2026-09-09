/**
 * 内置几何体生成器：返回 GeometryData（CPU 侧），
 * 之后用 Geometry.create(device, data) 上传。
 */

import type { GeometryData } from "./Geometry.js";

type Axis = "x" | "y" | "z";

/**
 * 生成一个轴向面（立方体等使用）。
 * 通过叉积判定三角形绕序，保证从“外侧”看为逆时针（配合背面剔除/法线）。
 */
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
  return { positions, normals, uvs, indices };
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
