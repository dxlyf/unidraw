import { Program } from "../../../resources.js";
export class MockProgram extends Program {
    constructor(device, desc) {
        super(desc);
        device.register(this);
    }
    destroyNative() { }
}
//# sourceMappingURL=MockProgram.js.map