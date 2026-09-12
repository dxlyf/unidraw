import { Program } from "../../../resources.js";
import type { ProgramDescriptor } from "../../../descriptors.js";
import { MockDevice } from "../MockDevice.js";
export declare class MockProgram extends Program {
    constructor(device: MockDevice, desc: ProgramDescriptor);
    protected destroyNative(): void;
}
//# sourceMappingURL=MockProgram.d.ts.map