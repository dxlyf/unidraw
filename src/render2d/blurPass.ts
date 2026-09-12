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

import { FullScreenPass, POSTFX_COMMON_GLSL, POSTFX_COMMON_WGSL } from "../render/postfx/FullScreenPass.js";
import type { Device } from "../device/Device.js";
import type { RenderPassEncoder } from "../command/encoder.js";
import type { Texture } from "../device/resources.js";
import type { TextureFormat } from "../gpu/types.js";

export class BlurPass extends FullScreenPass {
  constructor(device: Device, targetFormat?: TextureFormat) {
    super(device, { name: "2d-shadow-blur", fragment: { glsl: BLUR_GLSL, wgsl: BLUR_WGSL }, targetFormat });
  }

  /**
   * 沿 (dx, dy)（单位方向）模糊；`radius` 为像素步长。
   *
   * `tint` 给了就把结果直接变成**按阴影色着色、直通 alpha** 的图像
   * （`rgb = 阴影色`、`a = 覆盖率 × 阴影色 alpha`）：这样后面那次「合成」只要一次
   * **参数恒定**的直通拷贝 —— 同一个 pass 被多个阴影组复用时不会串参数
   * （UniformBlock 是**记录时写、回放时才读**的，参数不同的多次 draw 只会留下最后一次）。
   * `radius = 0` 时它退化成一次纯着色（9 个权重之和恰好是 1）。
   */
  drawDirection(
    pass: RenderPassEncoder,
    input: Texture,
    width: number,
    height: number,
    dx: number,
    dy: number,
    radius: number,
    tint?: { r: number; g: number; b: number; a: number },
  ): void {
    this.setParams(dx, dy, radius, tint ? 1 : 0, tint?.r ?? 0, tint?.g ?? 0, tint?.b ?? 0, tint?.a ?? 0);
    this.draw(pass, input, width, height);
  }
}

export interface ShadowCompositeOptions {
  /** 输出附件采样数：必须与调用方 pass 一致（见 `FullScreenPassOptions.sampleCount`） */
  sampleCount?: number;
  /** 采样遮罩时垂直翻转（见下方「翻转」说明） */
  flipY?: boolean;
}

export class ShadowCompositePass extends FullScreenPass {
  private readonly _flipY: boolean;

  constructor(device: Device, targetFormat?: TextureFormat, options: ShadowCompositeOptions = {}) {
    super(device, {
      name: "2d-shadow-composite",
      fragment: { glsl: SHADOW_GLSL, wgsl: SHADOW_WGSL },
      targetFormat,
      // 合成必须是「源覆盖目标」：`FullScreenPass` 默认不混合（后处理链用不上）
      blend: true,
      sampleCount: options.sampleCount,
    });
    this._flipY = options.flipY === true;
  }

  /** 按 `(r, g, b, a)` 的阴影颜色合成遮罩 */
  drawTint(pass: RenderPassEncoder, mask: Texture, width: number, height: number, r: number, g: number, b: number, a: number): void {
    this.setParams(r, g, b, a, this._flipY ? 1 : 0);
    this.draw(pass, mask, width, height);
  }
}

const BLUR_GLSL = `#version 300 es
precision highp float;
${POSTFX_COMMON_GLSL}
void main() {
  vec2 step = u_params.xy * u_texelSize.zw * u_params.z;
  float w0 = 0.2270270270;
  float w1 = 0.1945945946;
  float w2 = 0.1216216216;
  float w3 = 0.0540540541;
  float w4 = 0.0162162162;
  vec4 sum = texture(u_input, v_uv) * w0;
  sum += (texture(u_input, v_uv + step) + texture(u_input, v_uv - step)) * w1;
  sum += (texture(u_input, v_uv + step * 2.0) + texture(u_input, v_uv - step * 2.0)) * w2;
  sum += (texture(u_input, v_uv + step * 3.0) + texture(u_input, v_uv - step * 3.0)) * w3;
  sum += (texture(u_input, v_uv + step * 4.0) + texture(u_input, v_uv - step * 4.0)) * w4;
  fragColor = u_params.w > 0.5 ? vec4(u_params2.rgb, sum.a * u_params2.a) : sum;
}
`;

const BLUR_WGSL = `
${POSTFX_COMMON_WGSL}
@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  let step = vec2f(fx.u_params.x, fx.u_params.y) * fx.u_texelSize.zw * fx.u_params.z;
  var sum = textureSample(u_input, u_inputSampler, in.v_uv) * 0.2270270270;
  sum = sum + (textureSample(u_input, u_inputSampler, in.v_uv + step) + textureSample(u_input, u_inputSampler, in.v_uv - step)) * 0.1945945946;
  sum = sum + (textureSample(u_input, u_inputSampler, in.v_uv + step * 2.0) + textureSample(u_input, u_inputSampler, in.v_uv - step * 2.0)) * 0.1216216216;
  sum = sum + (textureSample(u_input, u_inputSampler, in.v_uv + step * 3.0) + textureSample(u_input, u_inputSampler, in.v_uv - step * 3.0)) * 0.0540540541;
  sum = sum + (textureSample(u_input, u_inputSampler, in.v_uv + step * 4.0) + textureSample(u_input, u_inputSampler, in.v_uv - step * 4.0)) * 0.0162162162;
  if (fx.u_params.w > 0.5) { return vec4f(fx.u_params2.rgb, sum.a * fx.u_params2.a); }
  return sum;
}
`;

const SHADOW_GLSL = `#version 300 es
precision highp float;
${POSTFX_COMMON_GLSL}
void main() {
  vec2 uv = v_uv;
  if (u_params2.x > 0.5) uv.y = 1.0 - uv.y;
  float coverage = texture(u_input, uv).a;
  float a = coverage * u_params.w;
  // 直通 alpha：rgb 用原始阴影色，alpha 才带覆盖率（见文件头说明）
  fragColor = vec4(u_params.rgb, a);
}
`;

const SHADOW_WGSL = `
${POSTFX_COMMON_WGSL}
@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  var uv = in.v_uv;
  if (fx.u_params2.x > 0.5) { uv.y = 1.0 - uv.y; }
  let coverage = textureSample(u_input, u_inputSampler, uv).a;
  let a = coverage * fx.u_params.w;
  return vec4f(fx.u_params.rgb, a);
}
`;
