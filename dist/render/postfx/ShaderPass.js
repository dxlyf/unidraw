/**
 * ShaderPass —— 自定义单趟后处理：给一对 fragment 源码（GLSL ES 3.00 + WGSL）即可。
 *
 * 可直接用 `POSTFX_COMMON_GLSL` / `POSTFX_COMMON_WGSL` 拿到统一的
 * `u_texelSize` / `u_params` / `u_params2` 与输入纹理 `u_input`。
 */
import { FullScreenPass } from "./FullScreenPass.js";
export class ShaderPass extends FullScreenPass {
    constructor(device, options) {
        super(device, {
            name: options.name ?? "shader",
            fragment: options.fragment,
            targetFormat: options.targetFormat,
            extraTextureCount: options.extraTextureCount,
        });
    }
}
//# sourceMappingURL=ShaderPass.js.map