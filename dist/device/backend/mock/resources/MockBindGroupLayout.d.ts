import { BindGroupLayout } from "../../../resources.js";
import type { BindGroupLayoutDescriptor } from "../../../descriptors.js";
import { MockDevice } from "../MockDevice.js";
export declare class MockBindGroupLayout extends BindGroupLayout {
    constructor(device: MockDevice, desc: BindGroupLayoutDescriptor);
    protected destroyNative(): void;
}
//# sourceMappingURL=MockBindGroupLayout.d.ts.map