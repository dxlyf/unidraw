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
import type { Device } from "../../device/Device.js";
import type { RenderPassEncoder } from "../../command/encoder.js";
import type { Texture } from "../../device/resources.js";
import type { TextureFormat } from "../../gpu/types.js";

export interface CopyPassOptions {
  /**
   * 垂直翻转。
   *
   * 为什么存在：全屏三角形把 `uv=(0,0)` 放在 NDC 左下角，而**渲染出来的纹理**
   * 在两种后端里的行序不同 —— WebGL2 的 NDC 上边落在内存最后一行（`v=1` = 图顶），
   * WebGPU 的 NDC 上边就是内存第 0 行（`v=0` = 图顶）。于是同一个全屏拷贝在
   * WebGL2 上是正的、在 WebGPU 上是上下颠倒的。
   *
   * 后处理链内部「采样 → 写入」两端用同一套约定，翻转会自相抵消（N 趟就有 N 次翻转），
   * 所以只有**把 MSAA 解析结果（几何渲染产物）呈现到画布**这种「链路只有一趟」的
   * 场景才会暴露。
   */
  flipY?: boolean;
}

export class CopyPass extends FullScreenPass {
  private readonly _flipY: boolean;

  constructor(device: Device, targetFormat?: TextureFormat, options: CopyPassOptions = {}) {
    super(device, { name: "copy", fragment: { glsl: COPY_GLSL, wgsl: COPY_WGSL }, targetFormat });
    this._flipY = options.flipY === true;
  }

  override draw(pass: RenderPassEncoder, input: Texture, width: number, height: number): void {
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
