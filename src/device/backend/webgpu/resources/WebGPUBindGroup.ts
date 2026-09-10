import { BindGroup, Buffer, Sampler, TextureView } from "../../../resources.js";
import type { BindGroupDescriptor } from "../../../descriptors.js";
import { assert } from "../../../../util/assert.js";
import { WebGPUBindGroupLayout } from "./WebGPUBindGroupLayout.js";
import { WebGPUBuffer } from "./WebGPUBuffer.js";
import { WebGPUDevice } from "../WebGPUDevice.js";
import { WebGPUSampler } from "./WebGPUSampler.js";
import { WebGPUTextureView } from "./WebGPUTextureView.js";

export class WebGPUBindGroup extends BindGroup {
  readonly gpuBindGroup: GPUBindGroup;

  constructor(device: WebGPUDevice, desc: BindGroupDescriptor) {
    super(desc);
    const layout = desc.layout as WebGPUBindGroupLayout;
    const byBinding = new Map(desc.entries.map((e) => [e.binding, e.resource]));
    const entries: GPUBindGroupEntry[] = [];
    for (const entry of layout.entries) {
      const resource = byBinding.get(entry.binding);
      assert(resource !== undefined, `bind group 缺少 binding ${entry.binding}`);
      if (resource instanceof Buffer) {
        entries.push({ binding: entry.binding, resource: (resource as WebGPUBuffer).gpuBuffer });
      } else if (resource instanceof Sampler) {
        entries.push({ binding: entry.binding, resource: (resource as WebGPUSampler).gpuSampler });
      } else if (resource instanceof TextureView) {
        entries.push({ binding: entry.binding, resource: (resource as WebGPUTextureView).gpuView() });
      }
    }
    this.gpuBindGroup = device.gpu.createBindGroup({ label: desc.label, layout: layout.gpuLayout, entries });
    device.register(this);
  }

  protected destroyNative(): void {}
}
