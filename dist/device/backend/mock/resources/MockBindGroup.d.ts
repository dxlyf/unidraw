import { BindGroup } from "../../../resources.js";
import type { BindGroupDescriptor } from "../../../descriptors.js";
import { MockDevice } from "../MockDevice.js";
export declare class MockBindGroup extends BindGroup {
    constructor(device: MockDevice, desc: BindGroupDescriptor);
    protected destroyNative(): void;
}
//# sourceMappingURL=MockBindGroup.d.ts.map