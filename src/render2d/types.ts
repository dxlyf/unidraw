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
  /** 图案采样器（图案填充时与 LUT 纹理配对，决定重复方式） */
  sampler?: import("../device/resources.js").Sampler;
  /** 文字图集纹理（kind === "text"） */
  texture?: Texture;
  /**
   * 这个 op 只画进阴影遮罩（不画进最终画面）。
   *
   * 值是**阴影参数组的键**（颜色+模糊+位移）：一帧里出现多组不同阴影参数时，
   * 每组各自一张遮罩图层，并按「该组第一个 op」的位置依次合成 —— 所以
   * `shadowBlur === 0` 的硬阴影不会被另一组的模糊半径带糊。
   */
  shadow?: string;
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
  /** 阴影颜色（CSS 颜色串；透明 = 不画阴影，与原生默认一致） */
  shadowColor: string;
  /** 阴影模糊半径（0 = 硬边阴影） */
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  clip: DeviceRect | null;
}

export const DEFAULT_FONT = "28px system-ui, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
