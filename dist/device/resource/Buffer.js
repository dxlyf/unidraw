import { ResourceBase } from "./ResourceBase.js";
/**
 * 顶点/索引/uniform/… 缓冲句柄。
 */
export class Buffer extends ResourceBase {
    size;
    usage;
    constructor(desc) {
        super(desc.label);
        this.size = desc.size;
        this.usage = desc.usage;
    }
}
//# sourceMappingURL=Buffer.js.map