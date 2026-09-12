/**
 * 文字：通过隐藏 2D canvas 把字形栅格化为纹理并缓存，
 * 再以“纹理四边形 + 顶点色”绘制（浏览器环境；非浏览器调用会给出明确错误）。
 */
import type { Device } from "../device/Device.js";
import type { Texture } from "../device/resources.js";
export interface GlyphInfo {
    texture: Texture;
    /** 纹素尺寸（图集里这段文字的位图大小） */
    width: number;
    height: number;
    /**
     * 图集左上角相对**对齐点**的水平偏移（`fillText` 的 x）。
     *
     * 常见误区：不能直接把 `actualBoundingBoxLeft` 当偏移。规范里
     * `actualBoundingBoxLeft` 是「对齐点 → 墨迹左边界」的距离（向左为正），
     * 所以墨迹左边界 = 对齐点 − `actualBoundingBoxLeft`；图集左边还要再留 `pad`。
     */
    offsetX: number;
    /** 图集上边缘相对**基线**的垂直偏移（`fillText` 的 y）；向上为负 */
    offsetY: number;
}
/** `measureText` 返回的度量（字段名与原生 `TextMetrics` 对齐） */
export interface TextMetricsLike {
    /** 前进宽度（原生排版用的宽度，也是 textAlign 对齐的依据） */
    width: number;
    actualBoundingBoxLeft: number;
    actualBoundingBoxRight: number;
    actualBoundingBoxAscent: number;
    actualBoundingBoxDescent: number;
    /** em 盒（字体）上下沿，`textBaseline` 的 top/middle/bottom 用它 */
    fontBoundingBoxAscent: number;
    fontBoundingBoxDescent: number;
}
export declare class TextRenderer {
    private readonly device;
    private cache;
    private metricsCache;
    private measureCtx;
    constructor(device: Device);
    private evictIfNeeded;
    private ctxForMeasure;
    /** 文字度量（带缓存） */
    measure(text: string, font: string): TextMetricsLike;
    /** 取字形（命中缓存直接返回，否则栅格化）；`strokeWidth > 0` 时栅格化描边字形 */
    getGlyph(text: string, font: string, strokeWidth?: number, rasterScale?: number): GlyphInfo;
    /**
     * 栅格化一段文字到纹理。
     *
     * 位置约定（要让 `fillText(text,x,y)` 的落点和原生 Canvas2D 一致）：
     * - 图集内**对齐点**（`textAlign:"left"` + `textBaseline:"alphabetic"` 的原点）
     *   放在 `(PAD - inkLeft, PAD - inkTop)`，于是墨迹左边界/上边界正好落在
     *   `PAD` 处，四周各留 `PAD` 纹素；
     * - 绘制时四边形左上角 = `(x + offsetX, y + offsetY)`，其中
     *   `offsetX = inkLeft - PAD`、`offsetY = inkTop - PAD`。
     *
     * `rasterScale`（默认 1）表示**一个用户单位等于多少设备像素**（`pixelRatio` ×
     * CTM 缩放）：按放大后的字号栅格化、再把返回的尺寸除以倍率，调用方拿到的仍是
     * 用户单位，而纹理与设备像素 1:1 —— 高分屏/放大绘制时字才不糊。
     */
    private rasterize;
    clear(): void;
}
//# sourceMappingURL=text.d.ts.map