import { Sampler } from "../../../resources.js";
import type { SamplerDescriptor } from "../../../descriptors.js";
import type { GL } from "../glUtils.js";
import { WebGL2Device } from "../WebGL2Device.js";
export declare class GLSampler extends Sampler {
    readonly glSampler: WebGLSampler;
    readonly gl: GL;
    readonly id: number;
    constructor(device: WebGL2Device, desc: SamplerDescriptor);
    /**
     * 仅当显式要求 mips 时才使用 mip 变体过滤；
     * 否则用非 mip 的 NEAREST/LINEAR，保证只有 base level 的纹理是“完整”的。
     */
    private minFilterGL;
    private wrapGL;
    protected destroyNative(): void;
}
//# sourceMappingURL=GLSampler.d.ts.map