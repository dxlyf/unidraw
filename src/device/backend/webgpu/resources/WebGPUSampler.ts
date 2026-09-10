import { Sampler } from "../../../resources.js";
import type { SamplerDescriptor } from "../../../descriptors.js";
import { WebGPUDevice } from "../WebGPUDevice.js";

export class WebGPUSampler extends Sampler {
  readonly gpuSampler: GPUSampler;

  constructor(device: WebGPUDevice, desc: SamplerDescriptor) {
    super(desc);
    this.gpuSampler = device.gpu.createSampler({
      label: desc.label,
      addressModeU: (desc.addressModeU ?? "clamp-to-edge") as GPUAddressMode,
      addressModeV: (desc.addressModeV ?? "clamp-to-edge") as GPUAddressMode,
      addressModeW: (desc.addressModeW ?? "clamp-to-edge") as GPUAddressMode,
      magFilter: (desc.magFilter ?? "linear") as GPUFilterMode,
      minFilter: (desc.minFilter ?? "linear") as GPUFilterMode,
      mipmapFilter: (desc.mipmapFilter ?? "linear") as GPUMipmapFilterMode,
      maxAnisotropy: desc.maxAnisotropy ?? 1,
    });
    device.register(this);
  }

  protected destroyNative(): void {}
}
