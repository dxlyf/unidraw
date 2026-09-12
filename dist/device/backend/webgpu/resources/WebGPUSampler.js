import { Sampler } from "../../../resources.js";
export class WebGPUSampler extends Sampler {
    gpuSampler;
    constructor(device, desc) {
        super(desc);
        this.gpuSampler = device.gpu.createSampler({
            label: desc.label,
            addressModeU: (desc.addressModeU ?? "clamp-to-edge"),
            addressModeV: (desc.addressModeV ?? "clamp-to-edge"),
            addressModeW: (desc.addressModeW ?? "clamp-to-edge"),
            magFilter: (desc.magFilter ?? "linear"),
            minFilter: (desc.minFilter ?? "linear"),
            mipmapFilter: (desc.mipmapFilter ?? "linear"),
            maxAnisotropy: desc.maxAnisotropy ?? 1,
        });
        device.register(this);
    }
    destroyNative() { }
}
//# sourceMappingURL=WebGPUSampler.js.map