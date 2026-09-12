import type { BindGroupLayoutDescriptor } from "../descriptors.js";
import { ResourceBase } from "./ResourceBase.js";
/**
 * bind group 布局（binding 类型/可见性/名称约定）。
 */
export declare abstract class BindGroupLayout extends ResourceBase {
    readonly descriptor: BindGroupLayoutDescriptor;
    constructor(desc: BindGroupLayoutDescriptor);
    get entries(): import("../descriptors.js").BindGroupLayoutEntryDescriptor[];
}
//# sourceMappingURL=BindGroupLayout.d.ts.map