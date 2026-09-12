import { RenderPipeline } from "../../../resources.js";
import { UnidrawError } from "../../../../util/assert.js";
import { toGPUColorTarget, toGPUVertexBufferLayout } from "../gpuUtils.js";
export class WebGPURenderPipeline extends RenderPipeline {
    gpuPipeline;
    constructor(device, desc) {
        super(desc);
        const program = desc.program;
        const layouts = desc.bindGroupLayouts.map((l) => l.gpuLayout);
        const vertex = {
            module: program.gpuModule,
            entryPoint: program.vertexEntryPoint,
            buffers: desc.vertex.buffers.map((b) => toGPUVertexBufferLayout(b)),
        };
        const fragment = {
            module: program.gpuModule,
            entryPoint: program.fragmentEntryPoint,
            targets: desc.targets.map((t) => toGPUColorTarget(t)),
        };
        const primitive = {
            topology: (desc.primitive?.topology ?? "triangle-list"),
        };
        if (desc.primitive?.cullMode && desc.primitive.cullMode !== "none") {
            primitive.cullMode = desc.primitive.cullMode;
            primitive.frontFace = (desc.primitive?.frontFace ?? "ccw");
        }
        const descriptor = {
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
                format: desc.depthStencil.format,
                depthWriteEnabled: desc.depthStencil.depthWriteEnabled,
                depthCompare: desc.depthStencil.depthCompare,
            };
        }
        try {
            this.gpuPipeline = device.gpu.createRenderPipeline(descriptor);
        }
        catch (e) {
            throw new UnidrawError(`[unidraw] 创建 WebGPU 渲染管线失败：${e instanceof Error ? e.message : String(e)}`);
        }
        device.register(this);
    }
    destroyNative() { }
}
//# sourceMappingURL=WebGPURenderPipeline.js.map