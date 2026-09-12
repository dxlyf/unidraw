/**
 * render2d 阴影用的两个全屏 pass：
 *
 * 1. `BlurPass` —— **可分离高斯模糊**（9 tap）。阴影先画进一张只有覆盖率的遮罩，
 *    再横、竖各模糊一次；两趟的采样/写入约定一致，所以不需要翻转。
 *    σ 与原生 `shadowBlur` 对齐：原生 blur ≈ 2σ（像素），
 *    而 9-tap 核自身 σ_k ≈ 2 个步长，因此「步长 = blur / 4」时 σ_eff ≈ blur / 2。
 *
 * 2. `ShadowCompositePass` —— 把模糊后的遮罩**按阴影颜色合成**到目标上。
 *    输出是**直通 alpha**：`rgb = 阴影色`、`a = 覆盖率 × 阴影色 alpha`，
 *    配合 source-over 混合即可；千万不要写成 `rgb × a`（预乘）再走同一套混合，
 *    那会把 alpha 乘两次（覆盖率被平方）。
 */
import { FullScreenPass } from "../render/postfx/FullScreenPass.js";
import type { Device } from "../device/Device.js";
import type { RenderPassEncoder } from "../command/encoder.js";
import type { Texture } from "../device/resources.js";
import type { TextureFormat } from "../gpu/types.js";
export declare class BlurPass extends FullScreenPass {
    constructor(device: Device, targetFormat?: TextureFormat);
    /**
     * 沿 (dx, dy)（单位方向）模糊；`radius` 为像素步长。
     *
     * `tint` 给了就把结果直接变成**按阴影色着色、直通 alpha** 的图像
     * （`rgb = 阴影色`、`a = 覆盖率 × 阴影色 alpha`）：这样后面那次「合成」只要一次
     * **参数恒定**的直通拷贝 —— 同一个 pass 被多个阴影组复用时不会串参数
     * （UniformBlock 是**记录时写、回放时才读**的，参数不同的多次 draw 只会留下最后一次）。
     * `radius = 0` 时它退化成一次纯着色（9 个权重之和恰好是 1）。
     */
    drawDirection(pass: RenderPassEncoder, input: Texture, width: number, height: number, dx: number, dy: number, radius: number, tint?: {
        r: number;
        g: number;
        b: number;
        a: number;
    }): void;
}
export interface ShadowCompositeOptions {
    /** 输出附件采样数：必须与调用方 pass 一致（见 `FullScreenPassOptions.sampleCount`） */
    sampleCount?: number;
    /** 采样遮罩时垂直翻转（见下方「翻转」说明） */
    flipY?: boolean;
}
export declare class ShadowCompositePass extends FullScreenPass {
    private readonly _flipY;
    constructor(device: Device, targetFormat?: TextureFormat, options?: ShadowCompositeOptions);
    /** 按 `(r, g, b, a)` 的阴影颜色合成遮罩 */
    drawTint(pass: RenderPassEncoder, mask: Texture, width: number, height: number, r: number, g: number, b: number, a: number): void;
}
//# sourceMappingURL=blurPass.d.ts.map