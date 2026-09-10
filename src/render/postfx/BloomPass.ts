/**
 * BloomPass —— 泛光：亮部提取 → 可分离高斯模糊（横/纵）→ 叠加回原图。
 *
 * 自带 `RenderTarget`（默认半分辨率）并通过 `ctx.encoder` 自己开 pass，
 * 所以它是「多趟效果」，但不依赖 composer 的特殊照顾（不会嵌套 pass）。
 */

import { FullScreenPass, POSTFX_COMMON_GLSL, POSTFX_COMMON_WGSL, type PostEffect, type PostEffectContext } from "./FullScreenPass.js";
import { RenderTarget } from "../RenderTarget.js";
import type { Device } from "../../device/Device.js";
import type { Texture } from "../../device/resources.js";
import type { TextureFormat } from "../../gpu/types.js";

export interface BloomOptions {
  /** 亮度阈值（只有超过它的像素才泛光） */
  threshold?: number;
  /** 泛光强度（叠加系数） */
  strength?: number;
  /** 模糊半径（像素） */
  radius?: number;
  /** 中间层分辨率比例（默认 0.5；越小越快越糊） */
  scale?: number;
  targetFormat?: TextureFormat;
}

export class BloomPass implements PostEffect {
  readonly name = "bloom";
  threshold: number;
  strength: number;
  radius: number;

  private readonly _device: Device;
  private readonly _bright: FullScreenPass;
  private readonly _blur: FullScreenPass;
  private readonly _composite: FullScreenPass;
  private readonly _scale: number;
  private readonly _format: TextureFormat;
  private _half: RenderTarget | null = null;
  private _tmp: RenderTarget | null = null;
  private _width = 0;
  private _height = 0;

  constructor(device: Device, options: BloomOptions = {}) {
    this._device = device;
    this.threshold = options.threshold ?? 0.75;
    this.strength = options.strength ?? 0.9;
    this.radius = options.radius ?? 2;
    this._scale = Math.max(0.1, Math.min(1, options.scale ?? 0.5));
    this._format = options.targetFormat ?? "rgba8unorm";
    this._bright = new FullScreenPass(device, {
      name: "bloom-bright",
      fragment: { glsl: BLOOM_BRIGHT_GLSL, wgsl: BLOOM_BRIGHT_WGSL },
      targetFormat: this._format,
    });
    this._blur = new FullScreenPass(device, {
      name: "bloom-blur",
      fragment: { glsl: BLOOM_BLUR_GLSL, wgsl: BLOOM_BLUR_WGSL },
      targetFormat: this._format,
    });
    this._composite = new FullScreenPass(device, {
      name: "bloom-composite",
      fragment: { glsl: BLOOM_COMPOSITE_GLSL, wgsl: BLOOM_COMPOSITE_WGSL },
      targetFormat: this._format,
      extraTextureCount: 1,
    });
  }

  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    const w = Math.max(1, Math.floor(width * this._scale));
    const h = Math.max(1, Math.floor(height * this._scale));
    if (!this._half || !this._tmp) {
      this._half = new RenderTarget(this._device, { width: w, height: h, format: this._format, depth: false, label: "bloom-half" });
      this._tmp = new RenderTarget(this._device, { width: w, height: h, format: this._format, depth: false, label: "bloom-tmp" });
    } else {
      this._half.resize(w, h);
      this._tmp.resize(w, h);
    }
  }

  render(ctx: PostEffectContext): void {
    if (!this._half || !this._tmp) this.resize(ctx.width, ctx.height);
    const half = this._half!;
    const tmp = this._tmp!;

    // 1) 亮部提取 → half
    this._renderTo(ctx, this._bright, ctx.inputs[0]!, half, () => this._bright.setParams(this.threshold, 0, 0, 0));
    // 2) 横向模糊 half → tmp
    this._renderTo(ctx, this._blur, half.texture, tmp, () => this._blur.setParams(this.radius, 1, 0, 0));
    // 3) 纵向模糊 tmp → half
    this._renderTo(ctx, this._blur, tmp.texture, half, () => this._blur.setParams(this.radius, 0, 0, 0));

    // 4) 叠加：原图 + 泛光 → 输出
    this._composite.setExtraTexture(0, half.texture);
    this._composite.setParams(this.strength, 0, 0, 0);
    const pass = ctx.beginOutputPass("bloom-composite");
    this._composite.draw(pass, ctx.inputs[0]!, ctx.width, ctx.height);
    pass.end();
  }

  dispose(): void {
    this._bright.dispose();
    this._blur.dispose();
    this._composite.dispose();
    this._half?.dispose();
    this._tmp?.dispose();
    this._half = null;
    this._tmp = null;
  }

  private _renderTo(
    ctx: PostEffectContext,
    fx: FullScreenPass,
    input: Texture,
    target: RenderTarget,
    configure: () => void,
  ): void {
    configure();
    const pass = ctx.encoder.beginRenderPass({
      label: `bloom-${fx.name}`,
      colorAttachments: [target.colorAttachment()],
      depthStencilAttachment: null,
    });
    fx.draw(pass, input, this._width, this._height);
    pass.end();
  }
}

const BLOOM_BRIGHT_GLSL = `#version 300 es
precision highp float;
${POSTFX_COMMON_GLSL}
// u_params.x = 阈值
void main() {
  vec3 c = texture(u_input, v_uv).rgb;
  float l = max(max(c.r, c.g), c.b);
  float k = max(l - u_params.x, 0.0) / max(l, 1e-4);
  fragColor = vec4(c * k, 1.0);
}
`;

const BLOOM_BRIGHT_WGSL = `
${POSTFX_COMMON_WGSL}
@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  let c = textureSample(u_input, u_inputSampler, in.v_uv).rgb;
  let l = max(max(c.r, c.g), c.b);
  let k = max(l - fx.u_params.x, 0.0) / max(l, 1e-4);
  return vec4f(c * k, 1.0);
}
`;

const BLOOM_BLUR_GLSL = `#version 300 es
precision highp float;
${POSTFX_COMMON_GLSL}
// u_params.x = 半径, u_params.y = 1 横向 / 0 纵向
void main() {
  vec2 dir = u_params.y > 0.5 ? vec2(u_texelSize.z, 0.0) : vec2(0.0, u_texelSize.w);
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = -4; i <= 4; i++) {
    float w = exp(-float(i * i) / 8.0);
    sum += texture(u_input, v_uv + dir * float(i) * u_params.x).rgb * w;
    total += w;
  }
  fragColor = vec4(sum / total, 1.0);
}
`;

const BLOOM_BLUR_WGSL = `
${POSTFX_COMMON_WGSL}
@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  var dir = vec2f(0.0, fx.u_texelSize.w);
  if (fx.u_params.y > 0.5) { dir = vec2f(fx.u_texelSize.z, 0.0); }
  var sum = vec3f(0.0);
  var total = 0.0;
  for (var i = -4; i <= 4; i = i + 1) {
    let w = exp(-f32(i * i) / 8.0);
    sum = sum + textureSample(u_input, u_inputSampler, in.v_uv + dir * f32(i) * fx.u_params.x).rgb * w;
    total = total + w;
  }
  return vec4f(sum / total, 1.0);
}
`;

const BLOOM_COMPOSITE_GLSL = `#version 300 es
precision highp float;
${POSTFX_COMMON_GLSL}
uniform sampler2D u_extra0;   // 泛光图
// u_params.x = 强度
void main() {
  vec3 base = texture(u_input, v_uv).rgb;
  vec3 bloom = texture(u_extra0, v_uv).rgb;
  fragColor = vec4(base + bloom * u_params.x, 1.0);
}
`;

const BLOOM_COMPOSITE_WGSL = `
${POSTFX_COMMON_WGSL}
@group(0) @binding(3) var u_extra0 : texture_2d<f32>;

@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  let base = textureSample(u_input, u_inputSampler, in.v_uv).rgb;
  let bloom = textureSample(u_extra0, u_inputSampler, in.v_uv).rgb;
  return vec4f(base + bloom * fx.u_params.x, 1.0);
}
`;
