import { Program } from "../../../resources.js";
import type { ProgramDescriptor } from "../../../descriptors.js";
import { MockDevice } from "../MockDevice.js";

export class MockProgram extends Program {
  constructor(device: MockDevice, desc: ProgramDescriptor) {
    super(desc);
    device.register(this);
  }
  protected destroyNative(): void {}
}
