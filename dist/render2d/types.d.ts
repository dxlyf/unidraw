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
    /**
     * 逻辑像素（网页坐标）→ 物理像素的倍率，等价 `devicePixelRatio`，默认 1。
     *
     * 给了它就表示「用户坐标按**逻辑像素**写」，框架自己乘倍率画到物理像素
     * （见 `Canvas2D.setPixelRatio`）。
     */
    pixelRatio?: number;
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
    /**
     * 阴影**扩散**（逻辑像素，默认 0）：把阴影轮廓向外扩张这么多，再按 `shadowBlur` 模糊。
     *
     * 原生 Canvas2D 没有这个属性（CSS `box-shadow` 有 spread）；这里是框架扩展。
     * 实现是**几何扩张**（沿轮廓法线外扩 + 顶点画圆盘；描边则直接加宽线宽），所以
     * `shadowBlur = 0` 时不会多产生任何 pass —— 比"用大模糊凑出扩散感"便宜得多，
     * 缩放比例大 / 半径大时尤其明显。
     */
    shadowSpread: number;
    shadowOffsetX: number;
    shadowOffsetY: number;
    clip: DeviceRect | null;
}
export declare const DEFAULT_FONT = "28px system-ui, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
//# sourceMappingURL=types.d.ts.map