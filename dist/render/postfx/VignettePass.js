/**
 * VignettePass —— 暗角：越靠画面边缘越暗。
 *
 * `strength` 0..1（0 = 关闭），`softness` 越大过渡越平滑。
 */
import { FullScreenPass, POSTFX_COMMON_GLSL, POSTFX_COMMON_WGSL } from "./FullScreenPass.js";
export class VignettePass extends FullScreenPass {
    /** 暗角强度（0 关闭） */
    strength;
    /** 软化程度（越大越平滑） */
    softness;
    constructor(device, options = {}) {
        super(device, { name: "vignette", fragment: { glsl: VIGNETTE_GLSL, wgsl: VIGNETTE_WGSL }, targetFormat: options.targetFormat });
        this.strength = options.strength ?? 0.45;
        this.softness = options.softness ?? 0.65;
    }
    render(ctx) {
        this.setParams(this.strength, this.softness, 0, 0);
        super.render(ctx);
    }
}
const VIGNETTE_GLSL = `#version 300 es
precision highp float;
${POSTFX_COMMON_GLSL}
// u_params: x=强度, y=软化
void main() {
  vec4 src = texture(u_input, v_uv);
  vec2 d = (v_uv - 0.5) * 2.0;
  float r = length(d) * 0.75;
  float v = smoothstep(1.0, max(1.0 - u_params.y, 0.01), r);
  float k = mix(1.0, v, clamp(u_params.x, 0.0, 1.0));
  fragColor = vec4(src.rgb * k, src.a);
}
`;
const VIGNETTE_WGSL = `
${POSTFX_COMMON_WGSL}
@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  let src = textureSample(u_input, u_inputSampler, in.v_uv);
  let d = (in.v_uv - vec2f(0.5)) * 2.0;
  let r = length(d) * 0.75;
  let v = smoothstep(1.0, max(1.0 - fx.u_params.y, 0.01), r);
  let k = mix(1.0, v, clamp(fx.u_params.x, 0.0, 1.0));
  return vec4f(src.rgb * k, src.a);
}
`;
//# sourceMappingURL=VignettePass.js.map