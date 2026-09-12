import { Sampler } from "../../../resources.js";
export class MockSampler extends Sampler {
    constructor(device, desc) {
        super(desc);
        device.register(this);
    }
    destroyNative() { }
}
//# sourceMappingURL=MockSampler.js.map