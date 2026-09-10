import { Sampler } from "../../../resources.js";
import type { SamplerDescriptor } from "../../../descriptors.js";
import { MockDevice } from "../MockDevice.js";

export class MockSampler extends Sampler {
  constructor(device: MockDevice, desc: SamplerDescriptor) {
    super(desc);
    device.register(this);
  }
  protected destroyNative(): void {}
}
