import type { Pt2 } from "./matrix.js";

export type PathOp =
  | { type: "move"; x: number; y: number }
  | { type: "line"; x: number; y: number }
  | { type: "quad"; x1: number; y1: number; x: number; y: number }
  | { type: "cubic"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: "arc"; cx: number; cy: number; r: number; a0: number; a1: number; ccw: boolean }
  | { type: "arcTo"; x1: number; y1: number; x2: number; y2: number; r: number }
  | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number; rot: number; a0: number; a1: number; ccw: boolean }
  | { type: "close" };


/** 压平后的子路径 */
export interface Contour {
  points: Pt2[];
  closed: boolean;
}

export const TAU = Math.PI * 2;

export function curveSteps(flatTolerance: number): number {
  // 容差越小采样越多；至少 4 段
  return Math.max(4, Math.ceil((Math.PI / 2) * Math.sqrt(1 / Math.max(1e-6, flatTolerance))));
}
