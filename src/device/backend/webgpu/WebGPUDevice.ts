/**
 * WebGPU 后端：把统一命令流翻译到 WebGPU。
 *
 * 与 WebGL2 后端共享同一套命令记录与资源句柄，提交时：
 * - 把统一 op 编码到原生 GPUCommandEncoder；
 * - canvas 颜色附件（null view）解析为 context.getCurrentTexture()，
 *   深度附件（null view）使用设备内部深度纹理（随画布自动重建）；
 * - 资源映射：uniform 布局 / 顶点格式 / 混合因子等名称与 WebGPU 一一对应。
 */

import { Device, type DeviceLimits } from "../../Device.js";
import { BindGroup, BindGroupLayout, Buffer, Program, RenderPipeline, Sampler, Texture, TextureView } from "../../resources.js";
import type {
  BindGroupDescriptor,
  BindGroupLayoutDescriptor,
  BufferDescriptor,
  ColorTargetDescriptor,
  ProgramDescriptor,
  RenderPipelineDescriptor,
  SamplerDescriptor,
  TextureDescriptor,
  TextureUploadOptions,
} from "../../descriptors.js";
import { assert, UnidrawError } from "../../../util/assert.js";
import { bindGroupLayoutCacheKey } from "../../descriptors.js";
import type { CommandBuffer } from "../../../command/encoder.js";
import type { CommandOp, DepthStencilAttachmentOp } from "../../../command/ops.js";
import type { ColorClearValue, TextureFormat } from "../../../gpu/types.js";
import { textureFormatInfo } from "../../../gpu/formats.js";
import type { VertexBufferLayoutDescriptor } from "../../descriptors.js";

/** WebGPU 内部 canvas 深度纹理格式（离屏与示例用同格式）。 */
export const WEBGPU_INTERNAL_DEPTH_FORMAT = "depth24plus";

function mapUsage(usage: number): GPUTextureUsageFlags {
  let out = 0;
  const U = { COPY_SRC: 1 << 0, COPY_DST: 1 << 1, TEXTURE_BINDING: 1 << 2, STORAGE_BINDING: 1 << 3, RENDER_ATTACHMENT: 1 << 4 };
  if (usage & U.COPY_SRC) out |= GPUTextureUsage.COPY_SRC;
  if (usage & U.COPY_DST) out |= GPUTextureUsage.COPY_DST;
  if (usage & U.TEXTURE_BINDING) out |= GPUTextureUsage.TEXTURE_BINDING;
  if (usage & U.STORAGE_BINDING) out |= GPUTextureUsage.STORAGE_BINDING;
  if (usage & U.RENDER_ATTACHMENT) out |= GPUTextureUsage.RENDER_ATTACHMENT;
  return out;
}

function mapBufferUsage(usage: number): GPUBufferUsageFlags {
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

function mapVisibility(flags: number): number {
  let out = 0;
  if (flags & 1) out |= GPUShaderStage.VERTEX;
  if (flags & 2) out |= GPUShaderStage.FRAGMENT;
  if (flags & 4) out |= GPUShaderStage.COMPUTE;
  return out;
}

// ---------------------------------------------------------------------------
// WebGPU 资源
// ---------------------------------------------------------------------------

function align4(n: number): number {
  return (n + 3) & ~3;
}

class WebGPUBuffer extends Buffer {
  readonly gpuBuffer: GPUBuffer;
  private readonly _device: WebGPUDevice;

  constructor(device: WebGPUDevice, desc: BufferDescriptor) {
    super(desc);
    assert(desc.size >= 0, "Buffer size 不能为负");
    this._device = device;
    // WebGPU 要求 buffer size 为 4 的倍数
    this.gpuBuffer = device.gpu.createBuffer({ label: desc.label, size: align4(desc.size), usage: mapBufferUsage(desc.usage) });
    device.register(this);
  }

  override write(data: ArrayBufferView | ArrayBuffer, offset = 0): void {
    assert(offset >= 0, "write offset 不能为负");
    assert(offset % 4 === 0, "WebGPU writeBuffer 的 buffer 偏移必须是 4 的倍数");
    const bytes = data instanceof ArrayBuffer ? data : data.buffer;
    const byteOffset = data instanceof ArrayBuffer ? 0 : data.byteOffset;
    const byteLength = data instanceof ArrayBuffer ? data.byteLength : data.byteLength;
    // writeBuffer 的写入字节数也必须是 4 的倍数；不足时补零到 4 的倍数
    if (byteLength % 4 !== 0) {
      const padded = new Uint8Array(align4(byteLength));
      padded.set(new Uint8Array(bytes, byteOffset, byteLength));
      this._device.gpu.queue.writeBuffer(this.gpuBuffer, offset, padded.buffer as ArrayBuffer, 0, padded.byteLength);
      return;
    }
    this._device.gpu.queue.writeBuffer(this.gpuBuffer, offset, bytes as ArrayBuffer, byteOffset, byteLength);
  }

  protected destroyNative(): void {
    this.gpuBuffer.destroy();
  }
}

class WebGPUTexture extends Texture {
  readonly gpuTexture: GPUTexture;
  private readonly _device: WebGPUDevice;

  constructor(device: WebGPUDevice, desc: TextureDescriptor) {
    super(desc);
    this._device = device;
    this.gpuTexture = device.gpu.createTexture({
      label: desc.label,
      size: { width: desc.width, height: desc.height },
      format: desc.format as GPUTextureFormat,
      usage: mapUsage(desc.usage),
      mipLevelCount: desc.mipLevelCount ?? 1,
    });
    device.register(this);
  }

  protected override createDefaultView(): TextureView {
    return new WebGPUTextureView(this);
  }

  override upload(data: ArrayBufferView, options: TextureUploadOptions = {}): void {
    const info = textureFormatInfo(this.format);
    const x = options.x ?? 0;
    const y = options.y ?? 0;
    const width = options.width ?? this.width;
    const height = options.height ?? this.height;
    const bytesPerRow = options.bytesPerRow ?? width * info.bytesPerTexel;
    const bpp = info.bytesPerTexel;
    assert(width >= 1 && height >= 1 && x >= 0 && y >= 0, "upload 区域非法");
    assert(x + width <= this.width && y + height <= this.height, "upload 区域越界");

    // WebGPU 要求 bytesPerRow 为 256 的倍数 → 必要时做行填充拷贝
    const aligned = Math.ceil(bytesPerRow / 256) * 256;
    let payload: ArrayBufferView = data;
    if (aligned !== bytesPerRow || data.byteOffset % 4 !== 0) {
      const copy = new Uint8Array(aligned * height);
      const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      for (let row = 0; row < height; row++) {
        copy.set(src.subarray(row * bytesPerRow, row * bytesPerRow + width * bpp), row * aligned);
      }
      payload = copy;
    }
    this._device.gpu.queue.writeTexture(
      { texture: this.gpuTexture, mipLevel: options.mipLevel ?? 0, origin: { x, y } },
      payload,
      { bytesPerRow: aligned, rowsPerImage: height },
      { width, height },
    );
  }

  override generateMipmaps(): void {
    // 简单场景：不做自动 mipmap（文档说明用法）
  }

  protected destroyNative(): void {
    this.gpuTexture.destroy();
  }
}

class WebGPUTextureView extends TextureView {
  constructor(texture: Texture) {
    super(texture);
  }

  /** 惰性创建 GPU 视图。 */
  gpuView(): GPUTextureView {
    return (this.texture as WebGPUTexture).gpuTexture.createView();
  }
}

class WebGPUSampler extends Sampler {
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

class WebGPUProgram extends Program {
  readonly gpuModule: GPUShaderModule;
  readonly vertexEntryPoint: string;
  readonly fragmentEntryPoint: string;

  constructor(device: WebGPUDevice, desc: ProgramDescriptor) {
    super(desc);
    assert(desc.wgsl, `program("${desc.label}") 缺少 wgsl 源码，无法在 WebGPU 后端使用`);
    this.vertexEntryPoint = desc.wgsl.vertexEntryPoint ?? "vs_main";
    this.fragmentEntryPoint = desc.wgsl.fragmentEntryPoint ?? "fs_main";
    this.gpuModule = device.gpu.createShaderModule({ label: desc.label, code: desc.wgsl.code });
    device.register(this);
    // 异步取回编译诊断（不阻塞创建，出错时尽快打印到控制台）
    this.gpuModule
      .getCompilationInfo()
      .then((info) => {
        if (info.messages.length > 0) {
          const lines = info.messages.map((m) => `  [${m.type}] ${m.message} (${m.lineNum ?? "?"}:${m.linePos ?? "?"})`);
          console.error(`[unidraw] WGSL 编译诊断 "${desc.label ?? "program"}":\n${lines.join("\n")}`);
        }
      })
      .catch(() => {});
  }

  protected destroyNative(): void {}
}

class WebGPUBindGroupLayout extends BindGroupLayout {
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

class WebGPUBindGroup extends BindGroup {
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

class WebGPURenderPipeline extends RenderPipeline {
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

function toGPUVertexBufferLayout(layout: VertexBufferLayoutDescriptor): GPUVertexBufferLayout {
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

function toGPUColorTarget(t: ColorTargetDescriptor): GPUColorTargetState {
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

// ---------------------------------------------------------------------------
// Device
// ---------------------------------------------------------------------------

export interface WebGPUDeviceOptions {
  powerPreference?: GPUPowerPreference;
  /** 覆盖自动获取的画布格式 */
  forceCanvasFormat?: GPUTextureFormat;
  label?: string;
}

export class WebGPUDevice extends Device {
  readonly gpu: GPUDevice;
  readonly adapter: GPUAdapter;
  readonly context: GPUCanvasContext;
  readonly canvasFormatNative: GPUTextureFormat;
  private _internalDepth: GPUTexture | null = null;
  private _internalDepthW = 0;
  private _internalDepthH = 0;
  private _configuredW = -1;
  private _configuredH = -1;
  private readonly _layoutCache = new Map<string, WebGPUBindGroupLayout>();
  private _limits: DeviceLimits | null = null;

  private constructor(adapter: GPUAdapter, gpu: GPUDevice, canvas: HTMLCanvasElement, canvasFormat: GPUTextureFormat) {
    const name = `WebGPU · ${adapterName(adapter)}`;
    super("webgpu", canvas, { kind: "webgpu", name, adapter: adapterName(adapter) });
    this.adapter = adapter;
    this.gpu = gpu;
    this.canvasFormatNative = canvasFormat;
    const ctx = canvas.getContext("webgpu");
    assert(ctx, "无法获取 webgpu canvas context");
    this.context = ctx;
    this.configureContext();
    // WebGPU 校验错误异步上报：始终打印，便于无需开日志即可排查
    gpu.addEventListener("uncapturederror", (e: Event) => {
      const ev = e as GPUUncapturedErrorEvent;
      console.error(`[unidraw] WebGPU validation error: ${ev.error?.message ?? "unknown"}`);
    });
    gpu.lost.then((info) => {
      console.error(`[unidraw] WebGPU device lost: ${info.reason ?? "unknown"}`);
    });
  }

  private configureContext(): void {
    this.context.configure({
      device: this.gpu,
      format: this.canvasFormatNative,
      alphaMode: "opaque",
    });
    this._configuredW = this.canvas?.width ?? -1;
    this._configuredH = this.canvas?.height ?? -1;
  }

  static async create(canvas: HTMLCanvasElement, options: WebGPUDeviceOptions = {}): Promise<WebGPUDevice> {
    if (!navigator.gpu) throw new UnidrawError("当前环境不支持 WebGPU（无 navigator.gpu）");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: options.powerPreference ?? "high-performance" });
    if (!adapter) throw new UnidrawError("未找到可用的 WebGPU adapter");
    const device = await adapter.requestDevice();
    const format = options.forceCanvasFormat ?? navigator.gpu.getPreferredCanvasFormat();
    return new WebGPUDevice(adapter, device, canvas, format);
  }

  override get limits(): DeviceLimits {
    if (!this._limits) {
      const gpu = this.gpu;
      this._limits = {
        maxVertexAttributes: gpu.limits.maxVertexAttributes,
        maxTextureUnits: 64,
        maxUniformBufferBindings: gpu.limits.maxUniformBuffersPerShaderStage * 4,
        maxTextureSize: gpu.limits.maxTextureDimension2D,
      };
    }
    return this._limits;
  }

  // ---- 资源创建 -----------------------------------------------------------

  override createBuffer(desc: BufferDescriptor): Buffer {
    return new WebGPUBuffer(this, desc);
  }
  override createTexture(desc: TextureDescriptor): Texture {
    return new WebGPUTexture(this, desc);
  }
  override createSampler(desc: SamplerDescriptor): Sampler {
    return new WebGPUSampler(this, desc);
  }
  override createProgram(desc: ProgramDescriptor): Program {
    return new WebGPUProgram(this, desc);
  }
  override createBindGroupLayout(desc: BindGroupLayoutDescriptor): BindGroupLayout {
    const key = bindGroupLayoutCacheKey(desc);
    const cached = this._layoutCache.get(key);
    if (cached) return cached;
    const layout = new WebGPUBindGroupLayout(this, desc);
    this._layoutCache.set(key, layout);
    return layout;
  }
  override createBindGroup(desc: BindGroupDescriptor): BindGroup {
    return new WebGPUBindGroup(this, desc);
  }
  override createRenderPipeline(desc: RenderPipelineDescriptor): RenderPipeline {
    return new WebGPURenderPipeline(this, desc);
  }

  // ---- 查询 ---------------------------------------------------------------

  override async onSubmittedWorkDone(): Promise<void> {
    await this.gpu.queue.onSubmittedWorkDone();
  }

  override presentSize(): { width: number; height: number } {
    const c = this.canvas;
    return { width: c?.width ?? 0, height: c?.height ?? 0 };
  }

  override canvasFormat(): TextureFormat | null {
    return this.canvasFormatNative as TextureFormat;
  }

  // ---- 提交 ---------------------------------------------------------------

  override submit(commandBuffers: readonly CommandBuffer[]): void {
    assert(!this.destroyed, "Device 已销毁，无法 submit");
    if (commandBuffers.length === 0) return;
    const native = this.gpu.createCommandEncoder();
    for (const buffer of commandBuffers) {
      this.encodeOps(native, buffer.ops);
    }
    this.gpu.queue.submit([native.finish()]);
  }

  protected override executeOps(ops: readonly CommandOp[]): void {
    const native = this.gpu.createCommandEncoder();
    this.encodeOps(native, ops);
    this.gpu.queue.submit([native.finish()]);
  }

  private encodeOps(native: GPUCommandEncoder, ops: readonly CommandOp[]): void {
    let pass: GPURenderPassEncoder | null = null;
    let canvasTexture: GPUTexture | null = null;

    for (const op of ops) {
      switch (op.k) {
        case "beginRenderPass": {
          assert(pass === null, "beginRenderPass 嵌套非法");
          const colors: GPURenderPassColorAttachment[] = [];
          for (const att of op.colorAttachments) {
            if (att === null) continue;
            if (att.view === null) {
              if (!canvasTexture) canvasTexture = this.acquireCanvasTexture();
              colors.push({ view: canvasTexture.createView(), ...colorAttachmentState(att.loadOp, att.storeOp, att.clearValue) });
            } else {
              const view = (att.view as WebGPUTextureView).gpuView();
              colors.push({ view, ...colorAttachmentState(att.loadOp, att.storeOp, att.clearValue) });
            }
          }
          const depthState: GPURenderPassDepthStencilAttachment | undefined = this.resolveDepthAttachment(op.depthStencilAttachment);
          pass = native.beginRenderPass({ label: op.label, colorAttachments: colors, depthStencilAttachment: depthState });
          break;
        }
        case "endRenderPass": {
          assert(pass, "endRenderPass 无对应 beginRenderPass");
          pass.end();
          pass = null;
          break;
        }
        case "setPipeline": {
          assert(pass, "setPipeline 必须在 render pass 内");
          pass.setPipeline((op.pipeline as WebGPURenderPipeline).gpuPipeline);
          break;
        }
        case "setBindGroup": {
          assert(pass, "setBindGroup 必须在 render pass 内");
          const group = (op.group as WebGPUBindGroup | null)?.gpuBindGroup;
          if (group) pass.setBindGroup(op.index, group);
          break;
        }
        case "setVertexBuffer": {
          assert(pass, "setVertexBuffer 必须在 render pass 内");
          if (op.buffer) pass.setVertexBuffer(op.slot, (op.buffer as WebGPUBuffer).gpuBuffer, op.offset);
          break;
        }
        case "setIndexBuffer": {
          assert(pass, "setIndexBuffer 必须在 render pass 内");
          if (op.buffer) pass.setIndexBuffer((op.buffer as WebGPUBuffer).gpuBuffer, op.format as GPUIndexFormat, op.offset);
          break;
        }
        case "setViewport": {
          assert(pass, "setViewport 必须在 render pass 内");
          pass.setViewport(op.x, op.y, op.width, op.height, op.minDepth, op.maxDepth);
          break;
        }
        case "setScissorRect": {
          assert(pass, "setScissorRect 必须在 render pass 内");
          pass.setScissorRect(op.x, op.y, op.width, op.height);
          break;
        }
        case "draw": {
          assert(pass, "draw 必须在 render pass 内");
          pass.draw(op.vertexCount, op.instanceCount, op.firstVertex, op.firstInstance);
          break;
        }
        case "drawIndexed": {
          assert(pass, "drawIndexed 必须在 render pass 内");
          pass.drawIndexed(op.indexCount, op.instanceCount, op.firstIndex, op.baseVertex, op.firstInstance);
          break;
        }
        case "pushDebugGroup":
          pass?.pushDebugGroup(op.label);
          break;
        case "popDebugGroup":
          pass?.popDebugGroup();
          break;
        default: {
          const exhaustive: never = op;
          throw new UnidrawError(`[unidraw] 未知命令 op：${JSON.stringify(exhaustive)}`);
        }
      }
    }
    assert(pass === null, "submit 前必须 end 所有 RenderPass");
  }

  private acquireCanvasTexture(): GPUTexture {
    const c = this.canvas;
    if (c) {
      const w = c.width;
      const h = c.height;
      if (w !== this._configuredW || h !== this._configuredH) {
        this.configureContext();
      }
    }
    return this.context.getCurrentTexture();
  }

  /** 解析深度附件：view null 表示设备内部画布深度纹理。 */
  private resolveDepthAttachment(att: DepthStencilAttachmentOp | null): GPURenderPassDepthStencilAttachment | undefined {
    if (!att) return undefined;
    let view: GPUTextureView;
    if (att.view === null) {
      view = this.internalDepthTexture().createView();
    } else {
      view = (att.view as WebGPUTextureView).gpuView();
    }
    const out: GPURenderPassDepthStencilAttachment = {
      view,
      depthLoadOp: att.depthLoadOp as GPULoadOp,
      depthStoreOp: att.depthStoreOp as GPUStoreOp,
    };
    if (out.depthLoadOp === "clear") out.depthClearValue = att.depthClearValue ?? 1;
    return out;
  }

  /** 懒创建随画布尺寸变化的内部深度纹理。 */
  private internalDepthTexture(): GPUTexture {
    const c = this.canvas;
    const w = c?.width ?? 0;
    const h = c?.height ?? 0;
    assert(w > 0 && h > 0, "canvas 尺寸为 0，无法创建深度纹理");
    if (this._internalDepth && this._internalDepthW === w && this._internalDepthH === h) return this._internalDepth;
    if (this._internalDepth) this._internalDepth.destroy();
    this._internalDepth = this.gpu.createTexture({
      label: "unidraw-internal-depth",
      size: { width: w, height: h },
      format: WEBGPU_INTERNAL_DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this._internalDepthW = w;
    this._internalDepthH = h;
    return this._internalDepth;
  }

  protected destroyNative(): void {
    if (this._internalDepth) {
      this._internalDepth.destroy();
      this._internalDepth = null;
    }
    this.gpu.destroy();
  }
}

function colorAttachmentState(
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

function adapterName(adapter: GPUAdapter): string {
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
