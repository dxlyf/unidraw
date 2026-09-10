import { RenderPipeline } from "../../../resources.js";
import type { RenderPipelineDescriptor } from "../../../descriptors.js";
import { UnidrawError } from "../../../../util/assert.js";
import { WebGPUBindGroupLayout } from "./WebGPUBindGroupLayout.js";
import { WebGPUDevice } from "../WebGPUDevice.js";
import { WebGPUProgram } from "./WebGPUProgram.js";
import { toGPUColorTarget, toGPUVertexBufferLayout } from "../gpuUtils.js";

export class WebGPURenderPipeline extends RenderPipeline {
  readonly gpuPipeline: GPURenderPipeline;

  constructor(device: WebGPUDevice, desc: RenderPipelineDescriptor) {
    super(desc);
    const program = desc.program as WebGPUProgram;
    const layouts = desc.bindGroupLayouts.map((l) => (l as WebGPUBindGroupLayout).gpuLayout);
    const vertex = {
      module: program.gpuModule,
      entryPoint: program.vertexEntryPoint,
      buffers: desc.vertex.buffers.map((b): GPUVertexBufferLayout => toGPUVertexBufferLayout(b)),
    };
    const fragment = {
      module: program.gpuModule,
      entryPoint: program.fragmentEntryPoint,
      targets: desc.targets.map((t): GPUColorTargetState => toGPUColorTarget(t)),
    };
    const primitive: GPUPrimitiveState = {
      topology: (desc.primitive?.topology ?? "triangle-list") as GPUPrimitiveTopology,
    };
    if (desc.primitive?.cullMode && desc.primitive.cullMode !== "none") {
      primitive.cullMode = desc.primitive.cullMode as GPUCullMode;
      primitive.frontFace = (desc.primitive?.frontFace ?? "ccw") as GPUFrontFace;
    }
    const descriptor: GPURenderPipelineDescriptor = {
      label: desc.label,
      layout: device.gpu.createPipelineLayout({ label: desc.label ? `${desc.label}-layout` : undefined, bindGroupLayouts: layouts }),
      vertex,
      fragment,
      primitive,
      // 注意：`multisample` 是 GPURenderPipelineDescriptor 的**顶层**成员，
      // 放进 fragment 会被 WebIDL 静默忽略（管线仍是 1x，MSAA 附件上校验失败）
      multisample: { count: Math.max(1, desc.multisample?.count ?? 1) },
    };
    if (desc.depthStencil) {
      descriptor.depthStencil = {
        format: desc.depthStencil.format as GPUTextureFormat,
        depthWriteEnabled: desc.depthStencil.depthWriteEnabled,
        depthCompare: desc.depthStencil.depthCompare as GPUCompareFunction,
      };
    }
    try {
      this.gpuPipeline = device.gpu.createRenderPipeline(descriptor);
    } catch (e) {
      throw new UnidrawError(`[unidraw] 创建 WebGPU 渲染管线失败：${e instanceof Error ? e.message : String(e)}`);
    }
    device.register(this);
  }

  protected destroyNative(): void {}
}
