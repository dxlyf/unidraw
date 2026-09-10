/**
 * ToneMapPass —— 色调映射 + 曝光（HDR → LDR）。
 *
 * | mode | 曲线 |
 * | --- | --- |
 * | `none` | 只乘曝光，直接截断 |
 * | `linear` | 曝光后 clamp 到 [0,1] |
 * | `reinhard` | `x / (x + 1)` |
 * | `aces` | ACES 电影级近似（默认） |
 */

import { FullScreenPass, POSTFX_COMMON_GLSL, POSTFX_COMMON_WGSL, type PostEffectContext } from "./FullScreenPass.js";
import type { Device } from "../../device/Device.js";
import type { TextureFormat } from "../../gpu/types.js";

export type ToneMappingMode = "none" | "linear" | "reinhard" | "aces";

export interface ToneMapOptions {
  mode?: ToneMappingMode;
  exposure?: number;
  targetFormat?: TextureFormat;
}

export class ToneMapPass extends FullScreenPass {
  mode: ToneMappingMode;
  exposure: number;

  constructor(device: Device, options: ToneMapOptions = {}) {
    super(device, { name: "tonemap", fragment: { glsl: TONEMAP_GLSL, wgsl: TONEMAP_WGSL }, targetFormat: options.targetFormat });
    this.mode = options.mode ?? "aces";
    this.exposure = options.exposure ?? 1;
  }

  override render(ctx: PostEffectContext): void {
    this.setParams(this.exposure, modeCode(this.mode), 0, 0);
    super.render(ctx);
  }
}

export function modeCode(mode: ToneMappingMode): number {
  return mode === "none" ? 0 : mode === "linear" ? 1 : mode === "reinhard" ? 2 : 3;
}

const TONEMAP_GLSL = `#version 300 es
precision highp float;
${POSTFX_COMMON_GLSL}
// u_params: x=曝光, y=模式(0 none / 1 linear / 2 reinhard / 3 aces)

vec3 acesFilm(vec3 x) {
  float a = 2.51; float b = 0.03; float c = 2.43; float d = 0.59; float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec3 color = texture(u_input, v_uv).rgb * max(u_params.x, 0.0);
  int mode = int(u_params.y + 0.5);
  if (mode == 1) color = clamp(color, 0.0, 1.0);
  else if (mode == 2) color = color / (color + vec3(1.0));
  else if (mode == 3) color = acesFilm(color);
  fragColor = vec4(color, 1.0);
}
`;

const TONEMAP_WGSL = `
${POSTFX_COMMON_WGSL}
fn acesFilm(x : vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  var color = textureSample(u_input, u_inputSampler, in.v_uv).rgb * max(fx.u_params.x, 0.0);
  let mode = i32(fx.u_params.y + 0.5);
  if (mode == 1) { color = clamp(color, vec3f(0.0), vec3f(1.0)); }
  else if (mode == 2) { color = color / (color + vec3f(1.0)); }
  else if (mode == 3) { color = acesFilm(color); }
  return vec4f(color, 1.0);
}
`;
