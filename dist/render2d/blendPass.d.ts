/**
 * `globalCompositeOperation` 里**必须以目标为输入**的那 11 种混合模式。
 *
 * 为什么单独一个 pass：`overlay / color-dodge / color-burn / hard-light / soft-light /
 * difference / exclusion / hue / saturation / color / luminosity` 的 `B(Cb, Cs)` 不能
 * 写成固定的混合因子 —— 目标颜色得当成纹理读进来。所以 render2d 在这种 op 出现时
 * 切到「图层模式」：
 *
 *   ① 本帧此前的绘制都落在一张图层纹理上（`dst`，绑定在 binding 1）；
 *   ② 该 op 的几何单独画进一张透明底的源图层（`src`，绑定在 binding 3）；
 *   ③ 本 pass 读 (dst, src) 按公式算出最终颜色，**关掉混合**整块写出；
 *   ④ 后续 op 继续画在这张新图层上（ping-pong）。
 *
 * 公式按 W3C Compositing and Blending Level 1。输入输出都按**直通 alpha**处理：
 * 图层里存的 rgb 其实是预乘的，所以先把两边都除以自己的 alpha 还原成直通颜色，
 * 算完再按 `αs` 与 `αb` 合成回预乘结果（这样和固定管线那条路径的存储约定一致）。
 *
 * 混合模式在源覆盖率为 0 的地方必须**保持目标不变**（`αs = 0` 时下面公式自然退化成
 * 恒等），所以不需要 `clearsOutside` 的补集四边形。
 */
import { FullScreenPass } from "../render/postfx/FullScreenPass.js";
import type { Device } from "../device/Device.js";
import type { RenderPassEncoder } from "../command/encoder.js";
import type { Texture } from "../device/resources.js";
import type { TextureFormat } from "../gpu/types.js";
import type { BlendStateDescriptor } from "../device/descriptors.js";
/** 图层呈现用的**预乘 over**：图层 rgb 已经是预乘的，用直通因子会乘两次 alpha */
export declare const PREMULTIPLIED_OVER: BlendStateDescriptor;
/** 模式名 → 着色器里的分支编号（顺序即 `DST_TEXTURE_BLEND_MODES` 的下标） */
export declare const DST_TEXTURE_BLEND_MODES: readonly ["overlay", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"];
/** 该合成模式是否要靠「目标当纹理」的着色器实现（是则返回分支编号，否则 -1） */
export declare function dstTextureBlendIndex(operation: string): number;
export declare class BlendModePass extends FullScreenPass {
    constructor(device: Device, targetFormat?: TextureFormat, sampleCount?: number);
    /**
     * `dst` 是本帧此前的图层，`src` 是这个 op 自己的图层；结果写进 `pass`。
     *
     * `flipY` 与阴影合成同一套道理：采样的是几何渲染出来的纹理，WebGPU 的行序反过来。
     */
    drawBlend(pass: RenderPassEncoder, dst: Texture, src: Texture, width: number, height: number, modeIndex: number, flipY: boolean): void;
}
/** 图层绘制 + 呈现（渲染2d 的「图层模式」用） */
export declare class LayerPass extends FullScreenPass {
    constructor(device: Device, targetFormat?: TextureFormat, sampleCount?: number, blend?: BlendStateDescriptor);
    /** 把图层纹理呈现到调用方的 pass（可选翻转） */
    drawLayer(pass: RenderPassEncoder, layer: Texture, width: number, height: number, flipY: boolean): void;
}
//# sourceMappingURL=blendPass.d.ts.map