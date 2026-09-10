/**
 * CopyPass —— 直通拷贝。
 *
 * 用途：
 * - 「无效果时把场景目标输出到画布/目标」；
 * - 按**输出格式**建立管线，用于把链路内部格式呈现到画布
 *   （例如链路是 `rgba16float`、画布是 `bgra8unorm`）。
 */

import { FullScreenPass, POSTFX_COMMON_GLSL, POSTFX_COMMON_WGSL } from "./FullScreenPass.js";
import type { Device } from "../../device/Device.js";
import type { TextureFormat } from "../../gpu/types.js";

export class CopyPass extends FullScreenPass {
  constructor(device: Device, targetFormat?: TextureFormat) {
    super(device, { name: "copy", fragment: { glsl: COPY_GLSL, wgsl: COPY_WGSL }, targetFormat });
  }
}

const COPY_GLSL = `#version 300 es
precision highp float;
${POSTFX_COMMON_GLSL}
void main() { fragColor = texture(u_input, v_uv); }
`;

const COPY_WGSL = `
${POSTFX_COMMON_WGSL}
@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  return textureSample(u_input, u_inputSampler, in.v_uv);
}
`;
