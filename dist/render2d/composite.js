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
const add = "add";
function blend(cs, cd, as, ad, clearsOutside = false) {
    return {
        color: { srcFactor: cs, dstFactor: cd, operation: add },
        alpha: { srcFactor: as, dstFactor: ad, operation: add },
        clearsOutside,
    };
}
/** 可用的合成模式 → 硬件混合状态（未列出的模式不支持，运行时告警并回退 source-over） */
export const COMPOSITE_BLENDS = {
    // 注意：片元输出是**直通 alpha**（非预乘），所以源颜色因子必须是 src-alpha。
    // 上表的 Porter-Duff 推导是在预乘空间做的，只有这一项（默认模式）需要按直通语义写回，
    // 否则所有半透明/抗锯齿像素都会偏亮。
    "source-over": blend("src-alpha", "one-minus-src-alpha", "one", "one-minus-src-alpha"),
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
];
export function blendForComposite(operation) {
    return COMPOSITE_BLENDS[operation] ?? null;
}
//# sourceMappingURL=composite.js.map