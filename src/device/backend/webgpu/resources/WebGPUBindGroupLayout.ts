import { BindGroupLayout } from "../../../resources.js";
import type { BindGroupLayoutDescriptor } from "../../../descriptors.js";
import { WebGPUDevice } from "../WebGPUDevice.js";
import { mapVisibility } from "../gpuUtils.js";

export class WebGPUBindGroupLayout extends BindGroupLayout {
  readonly gpuLayout: GPUBindGroupLayout;

  constructor(device: WebGPUDevice, desc: BindGroupLayoutDescriptor) {
    super(desc);
    const entries: GPUBindGroupLayoutEntry[] = desc.entries.map((e) => {
      const base: GPUBindGroupLayoutEntry = {
        binding: e.binding,
        visibility: mapVisibility(e.visibility),
      };
      if (e.type === "uniform-buffer") base.buffer = { type: "uniform" };
      else if (e.type === "texture") base.texture = { sampleType: "float", viewDimension: "2d" };
      else base.sampler = { type: "filtering" };
      return base;
    });
    this.gpuLayout = device.gpu.createBindGroupLayout({ label: desc.label, entries });
    device.register(this);
  }

  protected destroyNative(): void {}
}
