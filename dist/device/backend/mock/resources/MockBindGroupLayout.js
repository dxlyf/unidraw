import { BindGroupLayout } from "../../../resources.js";
export class MockBindGroupLayout extends BindGroupLayout {
    constructor(device, desc) {
        super(desc);
        device.register(this);
    }
    destroyNative() { }
}
//# sourceMappingURL=MockBindGroupLayout.js.map