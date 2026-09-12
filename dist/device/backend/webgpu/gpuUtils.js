export function mapUsage(usage) {
    let out = 0;
    const U = { COPY_SRC: 1 << 0, COPY_DST: 1 << 1, TEXTURE_BINDING: 1 << 2, STORAGE_BINDING: 1 << 3, RENDER_ATTACHMENT: 1 << 4 };
    if (usage & U.COPY_SRC)
        out |= GPUTextureUsage.COPY_SRC;
    if (usage & U.COPY_DST)
        out |= GPUTextureUsage.COPY_DST;
    if (usage & U.TEXTURE_BINDING)
        out |= GPUTextureUsage.TEXTURE_BINDING;
    if (usage & U.STORAGE_BINDING)
        out |= GPUTextureUsage.STORAGE_BINDING;
    if (usage & U.RENDER_ATTACHMENT)
        out |= GPUTextureUsage.RENDER_ATTACHMENT;
    return out;
}
export function mapBufferUsage(usage) {
    let out = 0;
    const B = { VERTEX: 1 << 0, INDEX: 1 << 1, UNIFORM: 1 << 2, STORAGE: 1 << 3, INDIRECT: 1 << 4, COPY_SRC: 1 << 5, COPY_DST: 1 << 6 };
    if (usage & B.VERTEX)
        out |= GPUBufferUsage.VERTEX;
    if (usage & B.INDEX)
        out |= GPUBufferUsage.INDEX;
    if (usage & B.UNIFORM)
        out |= GPUBufferUsage.UNIFORM;
    if (usage & B.STORAGE)
        out |= GPUBufferUsage.STORAGE;
    if (usage & B.INDIRECT)
        out |= GPUBufferUsage.INDIRECT;
    if (usage & B.COPY_SRC)
        out |= GPUBufferUsage.COPY_SRC;
    if (usage & B.COPY_DST)
        out |= GPUBufferUsage.COPY_DST;
    return out;
}
export function mapVisibility(flags) {
    let out = 0;
    if (flags & 1)
        out |= GPUShaderStage.VERTEX;
    if (flags & 2)
        out |= GPUShaderStage.FRAGMENT;
    if (flags & 4)
        out |= GPUShaderStage.COMPUTE;
    return out;
}
// ---------------------------------------------------------------------------
// WebGPU 资源
// ---------------------------------------------------------------------------
export function align4(n) {
    return (n + 3) & ~3;
}
export function toGPUVertexBufferLayout(layout) {
    return {
        arrayStride: layout.arrayStride,
        stepMode: (layout.stepMode ?? "vertex"),
        attributes: layout.attributes.map((a) => ({
            shaderLocation: a.location,
            offset: a.offset,
            format: a.format,
        })),
    };
}
export function toGPUColorTarget(t) {
    const target = { format: t.format };
    if (t.blend) {
        target.blend = {
            color: {
                operation: t.blend.color.operation,
                srcFactor: t.blend.color.srcFactor,
                dstFactor: t.blend.color.dstFactor,
            },
            alpha: {
                operation: t.blend.alpha.operation,
                srcFactor: t.blend.alpha.srcFactor,
                dstFactor: t.blend.alpha.dstFactor,
            },
        };
    }
    if (t.writeMask !== undefined)
        target.writeMask = t.writeMask;
    return target;
}
export function colorAttachmentState(loadOp, storeOp, clearValue) {
    const out = {
        loadOp: loadOp,
        storeOp: storeOp,
    };
    if (loadOp === "clear") {
        const c = clearValue ?? { r: 0, g: 0, b: 0, a: 1 };
        out.clearValue = { r: c.r, g: c.g, b: c.b, a: c.a };
    }
    return out;
}
export function adapterName(adapter) {
    try {
        const info = adapter.info;
        if (info && typeof info.vendor === "string") {
            return `${info.vendor}${info.architecture ? ` / ${info.architecture}` : ""}`;
        }
    }
    catch {
        /* 旧版 API 无 info */
    }
    return "unknown GPU";
}
export function isWebGPUSupported() {
    return typeof navigator !== "undefined" && navigator.gpu !== undefined;
}
//# sourceMappingURL=gpuUtils.js.map