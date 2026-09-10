import type { GeometryData } from "../Geometry.js";
import type { Axis } from "./types.js";
import { quadFace } from "./quad.js";


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
