import type { Texture } from "../device/resources.js";
import type { PaintStyle } from "./style.js";
import type { Affine } from "./matrix.js";

export type LineCap = "butt" | "round" | "square";

export type LineJoin = "miter" | "round" | "bevel";

export interface Canvas2DOptions {
  vertexCapacity?: number;
}

export interface DeviceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Op =
  | { kind: "flat"; clip: DeviceRect | null; iStart: number; iEnd: number }
  | { kind: "text"; clip: DeviceRect | null; texture: Texture; iStart: number; iEnd: number };

export interface SavedState {
  ctm: Affine;
  fillStyle: PaintStyle;
  strokeStyle: PaintStyle;
  globalAlpha: number;
  lineWidth: number;
  lineCap: LineCap;
  lineJoin: LineJoin;
  miterLimit: number;
  font: string;
  clip: DeviceRect | null;
}

export const DEFAULT_FONT = "28px system-ui, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
