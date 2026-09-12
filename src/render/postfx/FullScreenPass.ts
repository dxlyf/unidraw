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
import type { BindGroup, BindGroupLayout, Program, RenderPipeline, Sampler, Texture } from "../../device/resources.js";
import type { CommandEncoder, RenderPassEncoder } from "../../command/encoder.js";
import type { TextureFormat } from "../../gpu/types.js";
import type { BlendStateDescriptor } from "../../device/descriptors.js";
import { TextureUsage } from "../../gpu/types.js";
import { UniformBlock } from "../UniformBlock.js";
import { textureFormatInfo } from "../../gpu/formats.js";

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
  colorAttachment(options?: { clearValue?: { r: number; g: number; b: number; a: number } }): import("../../command/ops.js").ColorAttachmentOp;
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

const OVER_BLEND = {
  color: { srcFactor: "src-alpha" as const, dstFactor: "one-minus-src-alpha" as const, operation: "add" as const },
  alpha: { srcFactor: "one" as const, dstFactor: "one-minus-src-alpha" as const, operation: "add" as const },
};

export interface FullScreenPassOptions {
  name: string;
  /** 片元源码（GLSL 为 `#version 300 es`，入口 `main`；两侧都要给） */
  fragment: { glsl: string; wgsl: string };
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

export class FullScreenPass implements PostEffect {
  readonly name: string;
  readonly inputCount = 1;
  protected readonly device: Device;
  protected readonly params: UniformBlock;
  private readonly pipeline: RenderPipeline;
  private readonly layout: BindGroupLayout;
  private readonly sampler: Sampler;
  private readonly _extraCount: number;
  private readonly _extras: Texture[] = [];
  private _placeholder: Texture | null = null;
  private _cached: { key: string; group: BindGroup } | null = null;

  constructor(device: Device, options: FullScreenPassOptions) {
    this.device = device;
    this.name = options.name;
    this._extraCount = Math.max(0, Math.floor(options.extraTextureCount ?? 0));
    const targetFormat = options.targetFormat ?? "rgba8unorm";

    const program: Program = device.createProgram({
      label: `postfx-${options.name}`,
      glsl: { vertex: FULLSCREEN_VERTEX_GLSL, fragment: options.fragment.glsl },
      wgsl: { code: FULLSCREEN_VERTEX_WGSL + options.fragment.wgsl },
    });
    const entries: Parameters<Device["createBindGroupLayout"]>[0]["entries"] = [
      { binding: 0, type: "uniform-buffer", visibility: 2, name: "ParamsBlock" },
      {
        binding: 1,
        type: "texture",
        visibility: 2,
        name: "u_input",
        ...(options.textureSampleType === "depth" ? { sampleType: "depth" as const } : {}),
      },
      { binding: 2, type: "sampler", visibility: 2, name: "u_inputSampler" },
    ];
    for (let i = 0; i < this._extraCount; i++) {
      entries.push({ binding: 3 + i, type: "texture", visibility: 2, name: `u_extra${i}` });
    }
    this.layout = device.createBindGroupLayout({ label: `postfx-${options.name}-layout`, entries });
    this.params = new UniformBlock(device, {
      label: `postfx-${options.name}-params`,
      fields: [
        { name: "u_texelSize", type: "vec4" },
        { name: "u_params", type: "vec4" },
        { name: "u_params2", type: "vec4" },
      ],
    });
    this.sampler = device.createSampler({
      label: `postfx-${options.name}-sampler`,
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: options.nearest ? "nearest" : "linear",
      minFilter: options.nearest ? "nearest" : "linear",
      mips: false,
    });
    this.pipeline = device.createRenderPipeline({
      label: `postfx-${options.name}`,
      program,
      bindGroupLayouts: [this.layout],
      vertex: { buffers: [] },
      primitive: { topology: "triangle-list", cullMode: "none", frontFace: "ccw" },
      multisample: { count: Math.max(1, Math.floor(options.sampleCount ?? 1)) },
      depthStencil: null,
      targets: [
        {
          format: targetFormat,
          ...(options.blend ? { blend: options.blend === true ? OVER_BLEND : options.blend } : {}),
        },
      ],
    });
  }

  /** 设置自定义 uniform（`u_params` / `u_params2`） */
  setParams(a: number, b: number, c: number, d: number, e = 0, f = 0, g = 0, h = 0): this {
    this.params.setVec4("u_params", a, b, c, d);
    this.params.setVec4("u_params2", e, f, g, h);
    return this;
  }

  /** 设置第 i 张额外纹理（`extraTextureCount > 0` 时有效） */
  setExtraTexture(index: number, texture: Texture): this {
    this._extras[index] = texture;
    return this;
  }

  /** 由 composer 调用：把输入渲染到 `ctx.output`（自己开 pass，允许内部多趟） */
  render(ctx: PostEffectContext): void {
    const pass = ctx.beginOutputPass(this.name);
    this.draw(pass, ctx.inputs[0]!, ctx.width, ctx.height);
    pass.end();
  }

  /** 手动使用（不经过 composer 时） */
  draw(pass: RenderPassEncoder, input: Texture, width: number, height: number): void {
    this.params.setVec4("u_texelSize", width, height, 1 / Math.max(1, width), 1 / Math.max(1, height));
    this.params.flush();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this._bindGroupFor(input));
    pass.draw(3);
  }

  dispose(): void {
    this._placeholder?.destroy();
    this._placeholder = null;
    this._cached = null;
    this.params.buffer.destroy();
    this.sampler.destroy();
    this.pipeline.destroy();
  }

  private _makePlaceholder(): Texture {
    const tex = this.device.createTexture({
      label: `postfx-${this.name}-placeholder`,
      width: 1,
      height: 1,
      format: "rgba8unorm",
      usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST,
    });
    tex.upload(new Uint8Array(textureFormatInfo("rgba8unorm").bytesPerTexel));
    this._placeholder = tex;
    return tex;
  }

  private _bindGroupFor(input: Texture): BindGroup {
    const key = `${input.label ?? ""}#${this._extras.map((t) => t?.label ?? "?").join(",")}`;
    if (this._cached?.key === key) return this._cached.group;
    const placeholder = this._placeholder ?? this._makePlaceholder();
    const entries = [
      { binding: 0, resource: this.params.buffer },
      { binding: 1, resource: input.view() },
      { binding: 2, resource: this.sampler },
    ];
    for (let i = 0; i < this._extraCount; i++) {
      entries.push({ binding: 3 + i, resource: (this._extras[i] ?? placeholder).view() });
    }
    const group = this.device.createBindGroup({ label: `postfx-${this.name}-group`, layout: this.layout, entries });
    this._cached = { key, group };
    return group;
  }
}

const FULLSCREEN_VERTEX_GLSL = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  // 覆盖屏幕的大三角形：(-1,-1) (3,-1) (-1,3)
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FULLSCREEN_VERTEX_WGSL = `
struct VSOut {
  @builtin(position) clip_pos : vec4f,
  @location(0) v_uv : vec2f,
};
@vertex
fn vs_main(@builtin(vertex_index) index : u32) -> VSOut {
  let p = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var out : VSOut;
  out.clip_pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  out.v_uv = p;
  return out;
}
`;

/** 各效果公用的 uniform 声明 + 输入采样（GLSL） */
export const POSTFX_COMMON_GLSL = `
layout(std140) uniform ParamsBlock {
  vec4 u_texelSize;   // xy = 尺寸, zw = 1/尺寸
  vec4 u_params;      // 效果自定义
  vec4 u_params2;
};
uniform sampler2D u_input;
in vec2 v_uv;
out vec4 fragColor;
`;

/** 各效果公用的 uniform 声明 + 输入采样（WGSL） */
export const POSTFX_COMMON_WGSL = `
struct ParamsBlock {
  u_texelSize : vec4f,
  u_params : vec4f,
  u_params2 : vec4f,
};
@group(0) @binding(0) var<uniform> fx : ParamsBlock;
@group(0) @binding(1) var u_input : texture_2d<f32>;
@group(0) @binding(2) var u_inputSampler : sampler;

struct FSIn {
  @builtin(position) clip_pos : vec4f,
  @location(0) v_uv : vec2f,
};
`;
