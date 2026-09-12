import type { SamplerDescriptor } from "../descriptors.js";
import { ResourceBase } from "./ResourceBase.js";
/**
 * 采样器句柄（过滤/寻址；WebGPU 侧还有独立 sampler 对象，WebGL2 用 sampler object）。
 */
export declare abstract class Sampler extends ResourceBase {
    readonly descriptor: SamplerDescriptor;
    constructor(desc: SamplerDescriptor);
}
//# sourceMappingURL=Sampler.d.ts.map