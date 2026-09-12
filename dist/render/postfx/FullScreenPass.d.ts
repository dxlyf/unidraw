/**
 * 后处理效果契约 + 全屏 pass 基类。
 *
 * - `PostEffect`：一个后处理步骤（可多趟）。`EffectComposer` 按顺序执行，
 *   把上一步的输出纹理作为下一步的输入；
 * - `FullScreenPass`：最常见的「1 输入 + 画进当前附件」效果基类 ——
 *   只需要一对 fragment shader（GLSL ES 3.00 + WGSL），顶点阶段用
 *   `gl_VertexID` / `@builtin(vertex_index)` 生成覆盖屏幕的三角形（`draw(3)`，无需顶点缓冲）。
 *
 * 统一 bind group（0）：
 * | binding | 内容 |
 * | --- | --- |
 * | 0 | `ParamsBlock` UBO：`u_texelSize`(尺寸, 1/尺寸) / `u_params` / `u_params2` |
 * | 1 | 输入纹理 |
 * | 2 | 采样器（linear + clamp） |
 * | 3.. | 额外纹理（`extraTextureCount`，例如泛光图） |
 */
import type { Device } from "../../device/Device.js";
import type { Texture } from "../../device/resources.js";
import type { CommandEncoder, RenderPassEncoder } from "../../command/encoder.js";
import type { TextureFormat } from "../../gpu/types.js";
import type { BlendStateDescriptor } from "../../device/descriptors.js";
import { UniformBlock } from "../UniformBlock.js";
export interface PostEffectContext {
    device: Device;
    encoder: CommandEncoder;
    /** 输入纹理：[0] = 上一步结果 */
    inputs: readonly Texture[];
    width: number;
    height: number;
    /**
     * 本效果的输出目标（null = 画布）。
     *
     * 效果**自己**用 `beginOutputPass()` 开 pass 并 end —— 这样多趟效果
     * （例如 Bloom 先做亮部/模糊到自己的中间目标，最后再合成到输出）不会嵌套 pass。
     */
    output: RenderTargetLike | null;
    /** 开一个写向 `output` 的 pass（自动带上输出目标的深度附件） */
    beginOutputPass(label: string): RenderPassEncoder;
    /** 输出格式 */
    format: TextureFormat;
}
/** 只依赖 RenderTarget 的最小子集，避免 postfx 内部循环依赖 */
export interface RenderTargetLike {
    colorAttachment(options?: {
        clearValue?: {
            r: number;
            g: number;
            b: number;
            a: number;
        };
    }): import("../../command/ops.js").ColorAttachmentOp;
    depthAttachment(): import("../../command/ops.js").DepthStencilAttachmentOp | null;
    readonly texture: Texture;
}
/** 一个后处理步骤 */
export interface PostEffect {
    readonly name: string;
    /** 需要几张输入纹理（默认 1；Bloom 这类自给自足的效果也是 1） */
    readonly inputCount?: number;
    render(ctx: PostEffectContext): void;
    resize?(width: number, height: number): void;
    dispose?(): void;
}
/** 直通 alpha 的 source-over（render2d 的阴影/图层合成都用它） */
export declare const STRAIGHT_OVER: {
    color: {
        srcFactor: "src-alpha";
        dstFactor: "one-minus-src-alpha";
        operation: "add";
    };
    alpha: {
        srcFactor: "one";
        dstFactor: "one-minus-src-alpha";
        operation: "add";
    };
};
export interface FullScreenPassOptions {
    name: string;
    /** 片元源码（GLSL 为 `#version 300 es`，入口 `main`；两侧都要给） */
    fragment: {
        glsl: string;
        wgsl: string;
    };
    /** 输出格式（默认 rgba8unorm） */
    targetFormat?: TextureFormat;
    /** 额外输入纹理数量（会占用 binding 3 起的位置） */
    extraTextureCount?: number;
    /**
     * 用 NEAREST 采样（默认 false = LINEAR）。
     *
     * 读深度贴图/整数纹理时必须开：WebGL2 下「线性采样器 + 深度纹理」属于
     * **不完整纹理**（采样结果未定义）；`texelFetch` 虽然不看采样器状态，
     * 但纹理完整性检查仍会生效。
     */
    nearest?: boolean;
    /**
     * 输入纹理的采样类型（默认 `"float"`）。
     *
     * 读**深度纹理**时必须显式给 `"depth"`：WebGPU 的绑定布局会校验
     * `sampleType`，声明成 Float 再绑深度纹理会直接校验失败
     * （表现为整帧命令缓冲作废、`readPixels` 回读全是 0）。
     */
    textureSampleType?: "float" | "depth";
    /**
     * 输出是否带 **source-over 混合**（默认 false = 直接覆盖，后处理链用不上混合）。
     * render2d 的阴影合成需要它：输出的是「直通 alpha」的颜色，必须与目标做 over。
     *
     * 也可以直接给一个完整的 `BlendStateDescriptor`（例如图层合成要用的**预乘** over：
     * 图层的 rgb 已经是预乘的，再用直通因子会把 alpha 乘两次）。
     */
    blend?: boolean | BlendStateDescriptor;
    /**
     * 输出附件的采样数（默认 1）。
     *
     * 后处理链自己开的目标都是单采样，所以默认 1 就够；但 **render2d 的阴影合成是
     * 画进调用方那个 pass 的**，调用方开了 MSAA（`msaa: 4`）时管线必须跟着声明 4，
     * 否则 WebGPU 直接校验失败：`Attachment state of [RenderPipeline ...] is not
     * compatible with [RenderPassEncoder ...]`（整帧命令作废，回读全 0）。
     */
    sampleCount?: number;
}
export declare class FullScreenPass implements PostEffect {
    readonly name: string;
    readonly inputCount = 1;
    protected readonly device: Device;
    protected readonly params: UniformBlock;
    private readonly pipeline;
    private readonly layout;
    private readonly sampler;
    private readonly _extraCount;
    private readonly _extras;
    private _placeholder;
    constructor(device: Device, options: FullScreenPassOptions);
    /** 设置自定义 uniform（`u_params` / `u_params2`） */
    setParams(a: number, b: number, c: number, d: number, e?: number, f?: number, g?: number, h?: number): this;
    /** 设置第 i 张额外纹理（`extraTextureCount > 0` 时有效） */
    setExtraTexture(index: number, texture: Texture): this;
    /** 由 composer 调用：把输入渲染到 `ctx.output`（自己开 pass，允许内部多趟） */
    render(ctx: PostEffectContext): void;
    /** 手动使用（不经过 composer 时） */
    draw(pass: RenderPassEncoder, input: Texture, width: number, height: number): void;
    dispose(): void;
    private _makePlaceholder;
    /**
     * 输入纹理 → bind group。
     *
     * **必须按纹理身份（对象）缓存，不能按 `label` 缓存**：同一个 pass 会被反复用于
     * 多张目标，而这些目标的 label 往往一样（render2d 的每一组阴影遮罩都叫
     * `2d-shadow-mask-color`）—— 按 label 缓存会让第 2 组拿到第 1 组的 bind group，
     * 于是「模糊/合成读的是上一组的遮罩」：阴影张冠李戴、甚至叠在别的图形上。
     */
    private readonly _bindGroups;
    private _bindGroupFor;
}
/** 各效果公用的 uniform 声明 + 输入采样（GLSL） */
export declare const POSTFX_COMMON_GLSL = "\nlayout(std140) uniform ParamsBlock {\n  vec4 u_texelSize;   // xy = \u5C3A\u5BF8, zw = 1/\u5C3A\u5BF8\n  vec4 u_params;      // \u6548\u679C\u81EA\u5B9A\u4E49\n  vec4 u_params2;\n};\nuniform sampler2D u_input;\nin vec2 v_uv;\nout vec4 fragColor;\n";
/** 各效果公用的 uniform 声明 + 输入采样（WGSL） */
export declare const POSTFX_COMMON_WGSL = "\nstruct ParamsBlock {\n  u_texelSize : vec4f,\n  u_params : vec4f,\n  u_params2 : vec4f,\n};\n@group(0) @binding(0) var<uniform> fx : ParamsBlock;\n@group(0) @binding(1) var u_input : texture_2d<f32>;\n@group(0) @binding(2) var u_inputSampler : sampler;\n\nstruct FSIn {\n  @builtin(position) clip_pos : vec4f,\n  @location(0) v_uv : vec2f,\n};\n";
//# sourceMappingURL=FullScreenPass.d.ts.map