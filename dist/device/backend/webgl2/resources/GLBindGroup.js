import { BindGroup, Buffer, Sampler, TextureView } from "../../../resources.js";
import { assert } from "../../../../util/assert.js";
export class GLBindGroup extends BindGroup {
    constructor(device, desc) {
        super(desc);
        const byBinding = new Map(desc.layout.entries.map((e) => [e.binding, e]));
        for (const entry of desc.entries) {
            const def = byBinding.get(entry.binding);
            assert(def, `bind group binding ${entry.binding} 未在布局中声明`);
            if (def.type === "uniform-buffer")
                assert(entry.resource instanceof Buffer, `binding ${entry.binding} 需要 Buffer`);
            else if (def.type === "sampler")
                assert(entry.resource instanceof Sampler, `binding ${entry.binding} 需要 Sampler`);
            else
                assert(entry.resource instanceof TextureView, `binding ${entry.binding} 需要 TextureView`);
        }
        device.register(this);
    }
    destroyNative() { }
}
//# sourceMappingURL=GLBindGroup.js.map