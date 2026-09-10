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
    const byBinding = new Map(desc.entries.map((e) => [e.binding, e]));
    const entries: GPUBindGroupEntry[] = [];
    for (const entry of layout.entries) {
      const bound = byBinding.get(entry.binding);
      assert(bound !== undefined, `bind group 缺少 binding ${entry.binding}`);
      const resource = bound.resource;
      if (resource instanceof Buffer) {
        const gpuBuffer = (resource as WebGPUBuffer).gpuBuffer;
        // 动态偏移 UBO：给出 (offset, size) 区间，运行时由 setBindGroup 的 offsets 选择实际偏移
        const binding: GPUBufferBinding =
          bound.offset || bound.size || entry.hasDynamicOffset
            ? { buffer: gpuBuffer, offset: bound.offset ?? 0, size: bound.size ?? Math.max(0, resource.size - (bound.offset ?? 0)) }
            : { buffer: gpuBuffer };
        entries.push({ binding: entry.binding, resource: binding });
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
