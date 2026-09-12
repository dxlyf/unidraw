import { ResourceBase } from "./ResourceBase.js";
/**
 * 渲染管线句柄（program + 顶点状态 + 光栅/深度/混合 + 目标格式）。
 */
export class RenderPipeline extends ResourceBase {
    descriptor;
    constructor(desc) {
        super(desc.label);
        this.descriptor = desc;
    }
}
//# sourceMappingURL=RenderPipeline.js.map