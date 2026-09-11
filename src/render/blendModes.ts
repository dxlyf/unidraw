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
export function blendState(
  color: { src: BlendFactor; dst: BlendFactor; op?: BlendOperation },
  alpha: { src: BlendFactor; dst: BlendFactor; op?: BlendOperation } = { src: "one", dst: "one-minus-src-alpha" },
): BlendStateDescriptor {
  return {
    color: { srcFactor: color.src, dstFactor: color.dst, operation: color.op ?? "add" },
    alpha: { srcFactor: alpha.src, dstFactor: alpha.dst, operation: alpha.op ?? "add" },
  };
}

export interface BlendPreset {
  /** 稳定标识（用作 URL 参数/下拉框的值） */
  id: string;
  /** 中文说明（示例 GUI 用） */
  label: string;
  /** 混合状态；`undefined` = 不混合（不透明） */
  state?: BlendStateDescriptor;
}

/** 常用混合预设（顺序即示例下拉框的顺序） */
export const BLEND_PRESETS: readonly BlendPreset[] = [
  { id: "normal", label: "正常（alpha 混合）", state: blendState({ src: "src-alpha", dst: "one-minus-src-alpha" }) },
  { id: "additive", label: "叠加（发光）", state: blendState({ src: "src-alpha", dst: "one" }, { src: "one", dst: "one" }) },
  { id: "multiply", label: "正片叠底", state: blendState({ src: "dst", dst: "zero", op: "add" }) },
  { id: "screen", label: "滤色", state: blendState({ src: "one", dst: "one-minus-src", op: "add" }) },
  { id: "premultiplied", label: "预乘 alpha", state: blendState({ src: "one", dst: "one-minus-src-alpha" }) },
  {
    id: "subtract",
    label: "相减（dst - src）",
    state: blendState({ src: "src-alpha", dst: "one", op: "reverse-subtract" }, { src: "zero", dst: "one" }),
  },
  { id: "min", label: "取较暗（min）", state: blendState({ src: "one", dst: "one", op: "min" }, { src: "one", dst: "one", op: "min" }) },
  { id: "max", label: "取较亮（max）", state: blendState({ src: "one", dst: "one", op: "max" }, { src: "one", dst: "one", op: "max" }) },
  { id: "replace", label: "覆盖（不混合）" },
];

/** 按 id 取预设（未知 id 回退到第一个） */
export function blendPreset(id: string): BlendPreset {
  return BLEND_PRESETS.find((p) => p.id === id) ?? BLEND_PRESETS[0]!;
}

/** 标准 alpha 混合状态（等价 `MaterialOptions.alphaBlend: true`） */
export const ALPHA_BLEND: BlendStateDescriptor = blendState({ src: "src-alpha", dst: "one-minus-src-alpha" });
