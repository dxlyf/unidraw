import type { Texture } from "../device/resources.js";
import type { PaintStyle } from "./style.js";
import type { Affine } from "./matrix.js";

export type LineCap = "butt" | "round" | "square";

export type LineJoin = "miter" | "round" | "bevel";

/** 与原生一致的水平对齐 */
export type TextAlign = "left" | "right" | "center" | "start" | "end";

/** 与原生一致的基线（`hanging` / `ideographic` 用 em 盒近似） */
export type TextBaseline = "alphabetic" | "top" | "middle" | "bottom" | "hanging" | "ideographic";

export interface Canvas2DOptions {
  vertexCapacity?: number;
}

export interface DeviceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Op {
  kind: "flat" | "text";
  clip: DeviceRect | null;
  iStart: number;
  iEnd: number;
  /** 合成模式（决定管线里的混合状态；同 kind 不同模式要换管线） */
  comp: string;
  /** 渐变 LUT 纹理（纯色为 null → 绑 1x1 白纹理，着色器直接走顶点色） */
  lut?: Texture | null;
  /** 文字图集纹理（kind === "text"） */
  texture?: Texture;
}

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
  textAlign: TextAlign;
  textBaseline: TextBaseline;
  /** 虚线样式（空数组 = 实线） */
  lineDash: number[];
  lineDashOffset: number;
  /** 合成模式（`globalCompositeOperation`） */
  globalCompositeOperation: string;
  clip: DeviceRect | null;
}

export const DEFAULT_FONT = "28px system-ui, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
