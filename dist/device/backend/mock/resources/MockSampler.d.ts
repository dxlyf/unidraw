import { Sampler } from "../../../resources.js";
import type { SamplerDescriptor } from "../../../descriptors.js";
import { MockDevice } from "../MockDevice.js";
export declare class MockSampler extends Sampler {
    constructor(device: MockDevice, desc: SamplerDescriptor);
    protected destroyNative(): void;
}
//# sourceMappingURL=MockSampler.d.ts.map