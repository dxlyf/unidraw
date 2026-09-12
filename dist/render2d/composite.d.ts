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
 * 不支持硬件混合、改由 `blendPass.ts` 的**图层模式**实现的（overlay / color-dodge /
 * color-burn / hard-light / soft-light / difference / exclusion / hue / saturation /
 * color / luminosity）：这些要以**目标为输入**算 `B(Cb, Cs)`，走「2D 图层 + ping-pong」
 * + 一个读 (dst, src) 两张纹理的着色器（见 `dstTextureBlendIndex`）。
 *
 * `clearsOutside`：原生这些算子在「源覆盖率为 0」的区域会把目标也清掉
 * （等于拿整块画布参与运算）。逐片元混合只作用于画到的像素，所以要额外画一块
 * **路径的补集**（画布矩形 − 路径，evenodd 求得）并带上同一个混合状态，
 * 把形状之外的部分按规则清掉。图层模式那 11 种在 `αs = 0` 处公式本身就退化成恒等，
 * 不需要补集四边形。
 */
import type { BlendFactor, BlendOperation } from "../gpu/types.js";
export interface CompositeBlend {
    color: {
        srcFactor: BlendFactor;
        dstFactor: BlendFactor;
        operation: BlendOperation;
    };
    alpha: {
        srcFactor: BlendFactor;
        dstFactor: BlendFactor;
        operation: BlendOperation;
    };
    /** 需要补集四边形（把形状之外按同一规则一起算掉） */
    clearsOutside: boolean;
}
/** 可用的合成模式 → 硬件混合状态（未列出的模式不支持，运行时告警并回退 source-over） */
export declare const COMPOSITE_BLENDS: Record<string, CompositeBlend>;
/** 全部已知的合成模式名（用于告警信息） */
export declare const KNOWN_COMPOSITE_OPERATIONS: readonly ["source-over", "source-in", "source-out", "source-atop", "destination-over", "destination-in", "destination-out", "destination-atop", "lighter", "copy", "xor", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"];
export type CompositeOperation = (typeof KNOWN_COMPOSITE_OPERATIONS)[number];
export declare function blendForComposite(operation: string): CompositeBlend | null;
//# sourceMappingURL=composite.d.ts.map