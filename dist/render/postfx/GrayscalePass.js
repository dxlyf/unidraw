/**
 * GrayscalePass —— 灰度（Rec.709 亮度权重），`amount` 控制混合量。
 */
import { FullScreenPass, POSTFX_COMMON_GLSL, POSTFX_COMMON_WGSL } from "./FullScreenPass.js";
export class GrayscalePass extends FullScreenPass {
    /** 混合量 0..1 */
    amount;
    constructor(device, options = {}) {
        super(device, { name: "grayscale", fragment: { glsl: GRAYSCALE_GLSL, wgsl: GRAYSCALE_WGSL }, targetFormat: options.targetFormat });
        this.amount = options.amount ?? 1;
    }
    render(ctx) {
        this.setParams(this.amount, 0, 0, 0);
        super.render(ctx);
    }
}
const GRAYSCALE_GLSL = `#version 300 es
precision highp float;
${POSTFX_COMMON_GLSL}
void main() {
  vec3 c = texture(u_input, v_uv).rgb;
  float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
  fragColor = vec4(mix(c, vec3(g), clamp(u_params.x, 0.0, 1.0)), 1.0);
}
`;
const GRAYSCALE_WGSL = `
${POSTFX_COMMON_WGSL}
@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  let c = textureSample(u_input, u_inputSampler, in.v_uv).rgb;
  let g = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  return vec4f(mix(c, vec3f(g), clamp(fx.u_params.x, 0.0, 1.0)), 1.0);
}
`;
//# sourceMappingURL=GrayscalePass.js.map