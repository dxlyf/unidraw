import type { ColorTargetDescriptor } from "../../descriptors.js";
import type { ColorClearValue } from "../../../gpu/types.js";
import type { VertexBufferLayoutDescriptor } from "../../descriptors.js";

export function mapUsage(usage: number): GPUTextureUsageFlags {
  let out = 0;
  const U = { COPY_SRC: 1 << 0, COPY_DST: 1 << 1, TEXTURE_BINDING: 1 << 2, STORAGE_BINDING: 1 << 3, RENDER_ATTACHMENT: 1 << 4 };
  if (usage & U.COPY_SRC) out |= GPUTextureUsage.COPY_SRC;
  if (usage & U.COPY_DST) out |= GPUTextureUsage.COPY_DST;
  if (usage & U.TEXTURE_BINDING) out |= GPUTextureUsage.TEXTURE_BINDING;
  if (usage & U.STORAGE_BINDING) out |= GPUTextureUsage.STORAGE_BINDING;
  if (usage & U.RENDER_ATTACHMENT) out |= GPUTextureUsage.RENDER_ATTACHMENT;
  return out;
}

export function mapBufferUsage(usage: number): GPUBufferUsageFlags {
  let out = 0;
  const B = { VERTEX: 1 << 0, INDEX: 1 << 1, UNIFORM: 1 << 2, STORAGE: 1 << 3, INDIRECT: 1 << 4, COPY_SRC: 1 << 5, COPY_DST: 1 << 6 };
  if (usage & B.VERTEX) out |= GPUBufferUsage.VERTEX;
  if (usage & B.INDEX) out |= GPUBufferUsage.INDEX;
  if (usage & B.UNIFORM) out |= GPUBufferUsage.UNIFORM;
  if (usage & B.STORAGE) out |= GPUBufferUsage.STORAGE;
  if (usage & B.INDIRECT) out |= GPUBufferUsage.INDIRECT;
  if (usage & B.COPY_SRC) out |= GPUBufferUsage.COPY_SRC;
  if (usage & B.COPY_DST) out |= GPUBufferUsage.COPY_DST;
  return out;
}

export function mapVisibility(flags: number): number {
  let out = 0;
  if (flags & 1) out |= GPUShaderStage.VERTEX;
  if (flags & 2) out |= GPUShaderStage.FRAGMENT;
  if (flags & 4) out |= GPUShaderStage.COMPUTE;
  return out;
}


// ---------------------------------------------------------------------------
// WebGPU 资源
// ---------------------------------------------------------------------------
export function align4(n: number): number {
  return (n + 3) & ~3;
}

export function toGPUVertexBufferLayout(layout: VertexBufferLayoutDescriptor): GPUVertexBufferLayout {
  return {
    arrayStride: layout.arrayStride,
    stepMode: (layout.stepMode ?? "vertex") as GPUVertexStepMode,
    attributes: layout.attributes.map((a) => ({
      shaderLocation: a.location,
      offset: a.offset,
      format: a.format as GPUVertexFormat,
    })),
  };
}

export function toGPUColorTarget(t: ColorTargetDescriptor): GPUColorTargetState {
  const target: GPUColorTargetState = { format: t.format as GPUTextureFormat };
  if (t.blend) {
    target.blend = {
      color: {
        operation: t.blend.color.operation as GPUBlendOperation,
        srcFactor: t.blend.color.srcFactor as GPUBlendFactor,
        dstFactor: t.blend.color.dstFactor as GPUBlendFactor,
      },
      alpha: {
        operation: t.blend.alpha.operation as GPUBlendOperation,
        srcFactor: t.blend.alpha.srcFactor as GPUBlendFactor,
        dstFactor: t.blend.alpha.dstFactor as GPUBlendFactor,
      },
    };
  }
  if (t.writeMask !== undefined) target.writeMask = t.writeMask;
  return target;
}

export function colorAttachmentState(
  loadOp: "clear" | "load",
  storeOp: "store" | "discard",
  clearValue: ColorClearValue | undefined,
): { loadOp: GPULoadOp; storeOp: GPUStoreOp; clearValue?: GPUColor } {
  const out: { loadOp: GPULoadOp; storeOp: GPUStoreOp; clearValue?: GPUColor } = {
    loadOp: loadOp as GPULoadOp,
    storeOp: storeOp as GPUStoreOp,
  };
  if (loadOp === "clear") {
    const c = clearValue ?? { r: 0, g: 0, b: 0, a: 1 };
    out.clearValue = { r: c.r, g: c.g, b: c.b, a: c.a };
  }
  return out;
}

export function adapterName(adapter: GPUAdapter): string {
  try {
    const info = adapter.info;
    if (info && typeof info.vendor === "string") {
      return `${info.vendor}${info.architecture ? ` / ${info.architecture}` : ""}`;
    }
  } catch {
    /* 旧版 API 无 info */
  }
  return "unknown GPU";
}

export function isWebGPUSupported(): boolean {
  return typeof navigator !== "undefined" && navigator.gpu !== undefined;
}
