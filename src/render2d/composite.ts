/**
 * `globalCompositeOperation`：把 Canvas2D 的合成模式映射到**硬件混合状态**。
 *
 * 覆盖范围（与原生语义一致的那些）：
 * - Porter-Duff 全家桶：source-over / destination-over / source-in / destination-in /
 *   source-out / destination-out / source-atop / destination-atop / xor / lighter / copy；
 * - 可分离混合模式中能用混合因子/混合方程表达的：multiply / screen（用逐通道的
 *   `dst` / `one-minus-dst` 因子）、darken / lighten（用 `min` / `max` 混合方程）。
 *
 * 为什么这些能在**一次绘制、单个 pass**里做完：WebGL2 与 WebGPU 的混合因子都支持
 * 「逐通道的源/目标颜色」（GL 的 `DST_COLOR`、WebGPU 的 `dst`），混合方程也都有
 * `min` / `max`；因此不需要把目标读成纹理（那需要 2D 图层与额外的 pass）。
 *
 * 不支持的（overlay / color-dodge / color-burn / hard-light / soft-light /
 * difference / exclusion / hue / saturation / color / luminosity）需要**以目标为输入
 * 的着色器**，即「2D 图层 + ping-pong」；调用时会回退到 source-over 并告警。
 *
 * `clearsOutside`：原生这些算子在「源覆盖率为 0」的区域会把目标也清掉
 * （等于拿整块画布参与运算）。逐片元混合只作用于画到的像素，所以要额外画一块
 * **路径的补集**（画布矩形 − 路径，evenodd 求得）并带上同一个混合状态，
 * 把形状之外的部分按规则清掉。
 */

import type { BlendFactor, BlendOperation } from "../gpu/types.js";

export interface CompositeBlend {
  color: { srcFactor: BlendFactor; dstFactor: BlendFactor; operation: BlendOperation };
  alpha: { srcFactor: BlendFactor; dstFactor: BlendFactor; operation: BlendOperation };
  /** 需要补集四边形（把形状之外按同一规则一起算掉） */
  clearsOutside: boolean;
}

const add = "add" as const;

function blend(
  cs: BlendFactor,
  cd: BlendFactor,
  as: BlendFactor,
  ad: BlendFactor,
  clearsOutside = false,
): CompositeBlend {
  return {
    color: { srcFactor: cs, dstFactor: cd, operation: add },
    alpha: { srcFactor: as, dstFactor: ad, operation: add },
    clearsOutside,
  };
}

/** 可用的合成模式 → 硬件混合状态（未列出的模式不支持，运行时告警并回退 source-over） */
export const COMPOSITE_BLENDS: Record<string, CompositeBlend> = {
  "source-over": blend("one", "one-minus-src-alpha", "one", "one-minus-src-alpha"),
  "destination-over": blend("one-minus-dst-alpha", "one", "one-minus-dst-alpha", "one"),
  "source-in": blend("dst-alpha", "zero", "dst-alpha", "zero", true),
  "destination-in": blend("zero", "src-alpha", "zero", "src-alpha", true),
  "source-out": blend("one-minus-dst-alpha", "zero", "one-minus-dst-alpha", "zero", true),
  "destination-out": blend("zero", "one-minus-src-alpha", "zero", "one-minus-src-alpha"),
  "source-atop": blend("dst-alpha", "one-minus-src-alpha", "dst-alpha", "one-minus-src-alpha"),
  "destination-atop": blend("one-minus-dst-alpha", "src-alpha", "one-minus-dst-alpha", "src-alpha", true),
  xor: blend("one-minus-dst-alpha", "one-minus-src-alpha", "one-minus-dst-alpha", "one-minus-src-alpha"),
  lighter: blend("one", "one", "one", "one"),
  copy: blend("one", "zero", "one", "zero", true),
  // 混合模式：颜色用逐通道目标因子表达 B(Cb, Cs)，alpha 仍是 source-over
  multiply: blend("dst", "zero", "one", "one-minus-src-alpha"),
  screen: blend("one-minus-dst", "one", "one", "one-minus-src-alpha"),
  darken: {
    color: { srcFactor: "one", dstFactor: "one", operation: "min" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: add },
    clearsOutside: false,
  },
  lighten: {
    color: { srcFactor: "one", dstFactor: "one", operation: "max" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: add },
    clearsOutside: false,
  },
};

/** 全部已知的合成模式名（用于告警信息） */
export const KNOWN_COMPOSITE_OPERATIONS = [
  "source-over",
  "source-in",
  "source-out",
  "source-atop",
  "destination-over",
  "destination-in",
  "destination-out",
  "destination-atop",
  "lighter",
  "copy",
  "xor",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;

export type CompositeOperation = (typeof KNOWN_COMPOSITE_OPERATIONS)[number];

export function blendForComposite(operation: string): CompositeBlend | null {
  return COMPOSITE_BLENDS[operation] ?? null;
}
