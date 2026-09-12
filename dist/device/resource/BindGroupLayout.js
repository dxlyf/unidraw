import { ResourceBase } from "./ResourceBase.js";
/**
 * bind group 布局（binding 类型/可见性/名称约定）。
 */
export class BindGroupLayout extends ResourceBase {
    descriptor;
    constructor(desc) {
        super(desc.label);
        this.descriptor = desc;
    }
    get entries() {
        return this.descriptor.entries;
    }
}
//# sourceMappingURL=BindGroupLayout.js.map