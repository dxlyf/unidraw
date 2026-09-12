import { BindGroupLayout } from "../../../resources.js";
import { mapVisibility } from "../gpuUtils.js";
export class WebGPUBindGroupLayout extends BindGroupLayout {
    gpuLayout;
    constructor(device, desc) {
        super(desc);
        const entries = desc.entries.map((e) => {
            const base = {
                binding: e.binding,
                visibility: mapVisibility(e.visibility),
            };
            if (e.type === "uniform-buffer") {
                base.buffer = { type: "uniform", hasDynamicOffset: e.hasDynamicOffset === true };
            }
            else if (e.type === "texture") {
                base.texture = {
                    sampleType: (e.sampleType ?? "float"),
                    viewDimension: "2d",
                };
            }
            else
                base.sampler = { type: "filtering" };
            return base;
        });
        this.gpuLayout = device.gpu.createBindGroupLayout({ label: desc.label, entries });
        device.register(this);
    }
    destroyNative() { }
}
//# sourceMappingURL=WebGPUBindGroupLayout.js.map