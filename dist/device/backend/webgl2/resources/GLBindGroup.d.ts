import { BindGroup } from "../../../resources.js";
import type { BindGroupDescriptor } from "../../../descriptors.js";
import { WebGL2Device } from "../WebGL2Device.js";
export declare class GLBindGroup extends BindGroup {
    constructor(device: WebGL2Device, desc: BindGroupDescriptor);
    protected destroyNative(): void;
}
//# sourceMappingURL=GLBindGroup.d.ts.map