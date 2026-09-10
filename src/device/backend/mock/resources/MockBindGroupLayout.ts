import { BindGroupLayout } from "../../../resources.js";
import type { BindGroupLayoutDescriptor } from "../../../descriptors.js";
import { MockDevice } from "../MockDevice.js";

export class MockBindGroupLayout extends BindGroupLayout {
  constructor(device: MockDevice, desc: BindGroupLayoutDescriptor) {
    super(desc);
    device.register(this);
  }
  protected destroyNative(): void {}
}
