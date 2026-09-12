/**
 * CopyPass —— 直通拷贝。
 *
 * 用途：
 * - 「无效果时把场景目标输出到画布/目标」；
 * - 按**输出格式**建立管线，用于把链路内部格式呈现到画布
 *   （例如链路是 `rgba16float`、画布是 `bgra8unorm`）。
 *
 * `flipY`：垂直翻转。把「几何渲染出来的纹理」直接呈现到画布时，
 * **WebGPU 必须打开**（原因见 `CopyPassOptions.flipY`）。
 */
import { FullScreenPass, POSTFX_COMMON_GLSL, POSTFX_COMMON_WGSL } from "./FullScreenPass.js";
export class CopyPass extends FullScreenPass {
    _flipY;
    constructor(device, targetFormat, options = {}) {
        super(device, {
            name: "copy",
            fragment: { glsl: COPY_GLSL, wgsl: COPY_WGSL },
            targetFormat,
            sampleCount: options.sampleCount,
            blend: options.blend,
        });
        this._flipY = options.flipY === true;
    }
    draw(pass, input, width, height) {
        // u_params.x = 翻转开关（见 COPY_GLSL / COPY_WGSL）
        this.setParams(this._flipY ? 1 : 0, 0, 0, 0);
        super.draw(pass, input, width, height);
    }
}
const COPY_GLSL = `#version 300 es
precision highp float;
${POSTFX_COMMON_GLSL}
void main() {
  vec2 uv = v_uv;
  if (u_params.x > 0.5) uv.y = 1.0 - uv.y;
  fragColor = texture(u_input, uv);
}
`;
const COPY_WGSL = `
${POSTFX_COMMON_WGSL}
@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  var uv = in.v_uv;
  if (fx.u_params.x > 0.5) { uv.y = 1.0 - uv.y; }
  return textureSample(u_input, u_inputSampler, uv);
}
`;
//# sourceMappingURL=CopyPass.js.map