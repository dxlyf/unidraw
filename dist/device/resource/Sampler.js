import { ResourceBase } from "./ResourceBase.js";
/**
 * 采样器句柄（过滤/寻址；WebGPU 侧还有独立 sampler 对象，WebGL2 用 sampler object）。
 */
export class Sampler extends ResourceBase {
    descriptor;
    constructor(desc) {
        super(desc.label);
        this.descriptor = { ...desc };
    }
}
//# sourceMappingURL=Sampler.js.map