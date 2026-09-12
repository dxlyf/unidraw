/**
 * 混合模式（blend state）常用预设。
 *
 * 统一用 `BlendStateDescriptor` 描述（与 WebGPU `GPUBlendComponent` 一一对应），
 * 三个后端都支持；配合 `MaterialOptions.blend` 使用：
 *
 * ```ts
 * const glass = new PhongMaterial(device, color, {
 *   blend: BLEND_PRESETS.additive.state,   // 叠加发光
 *   depthWrite: false,                     // 半透明通常不写深度
 * });
 * ```
 *
 * 注意：**半透明物体不写深度（`depthWrite: false`）时不会互相遮挡**，
 * 叠加顺序需要由绘制顺序决定 —— `SceneRenderer` 会把带 `blend`/`alphaBlend`
 * 的材质排在不透明物体之后并按距离**远→近**绘制（见 `BaseMaterial.isTransparent`）。
 */
import type { BlendStateDescriptor } from "../device/descriptors.js";
import type { BlendFactor, BlendOperation } from "../gpu/types.js";
/** 构造混合状态（颜色与 alpha 可以分别给；缺省用同一组 factor） */
export declare function blendState(color: {
    src: BlendFactor;
    dst: BlendFactor;
    op?: BlendOperation;
}, alpha?: {
    src: BlendFactor;
    dst: BlendFactor;
    op?: BlendOperation;
}): BlendStateDescriptor;
export interface BlendPreset {
    /** 稳定标识（用作 URL 参数/下拉框的值） */
    id: string;
    /** 中文说明（示例 GUI 用） */
    label: string;
    /** 混合状态；`undefined` = 不混合（不透明） */
    state?: BlendStateDescriptor;
}
/** 常用混合预设（顺序即示例下拉框的顺序） */
export declare const BLEND_PRESETS: readonly BlendPreset[];
/** 按 id 取预设（未知 id 回退到第一个） */
export declare function blendPreset(id: string): BlendPreset;
/** 标准 alpha 混合状态（等价 `MaterialOptions.alphaBlend: true`） */
export declare const ALPHA_BLEND: BlendStateDescriptor;
//# sourceMappingURL=blendModes.d.ts.map