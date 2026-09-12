import { ResourceBase } from "./ResourceBase.js";
/**
 * bind group（一组绑定资源的快照；内容变化需重建）。
 */
export class BindGroup extends ResourceBase {
    descriptor;
    constructor(desc) {
        super(desc.label);
        this.descriptor = desc;
    }
}
//# sourceMappingURL=BindGroup.js.map