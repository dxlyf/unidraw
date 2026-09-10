import { Device, DeviceLimits } from "../../Device.js";
import { BindGroup, BindGroupLayout, Buffer, Program, RenderPipeline, Sampler, Texture } from "../../resources.js";
import type { BindGroupDescriptor, BindGroupLayoutDescriptor, BufferDescriptor, ProgramDescriptor, RenderPipelineDescriptor, SamplerDescriptor, TextureDescriptor } from "../../descriptors.js";
import { assert, UnidrawError } from "../../../util/assert.js";
import { bindGroupLayoutCacheKey } from "../../descriptors.js";
import type { CommandBuffer } from "../../../command/encoder.js";
import type { CommandOp, DepthStencilAttachmentOp } from "../../../command/ops.js";
import type { TextureFormat } from "../../../gpu/types.js";
import { TextureUsage } from "../../../gpu/types.js";
import type { WebGPUDeviceOptions } from "./types.js";
import { WEBGPU_INTERNAL_DEPTH_FORMAT } from "./constants.js";
import { WebGPUBindGroup } from "./resources/WebGPUBindGroup.js";
import { WebGPUBindGroupLayout } from "./resources/WebGPUBindGroupLayout.js";
import { WebGPUBuffer } from "./resources/WebGPUBuffer.js";
import { WebGPUProgram } from "./resources/WebGPUProgram.js";
import { WebGPURenderPipeline } from "./resources/WebGPURenderPipeline.js";
import { WebGPUSampler } from "./resources/WebGPUSampler.js";
import { WebGPUTexture } from "./resources/WebGPUTexture.js";
import { WebGPUTextureView } from "./resources/WebGPUTextureView.js";
import { adapterName, colorAttachmentState } from "./gpuUtils.js";
import { repackRows, resolveReadRect, swizzleBgraToRgbaInPlace, type ReadPixelsOptions } from "../../readback.js";

/** WebGPU `copyTextureToBuffer` 要求 bytesPerRow 为 256 的倍数。 */
function align256(value: number): number {
  return Math.ceil(value / 256) * 256;
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
        minUniformBufferOffsetAlignment: gpu.limits.minUniformBufferOffsetAlignment,
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

  /**
   * 纹理回读：`copyTextureToBuffer` + `mapAsync`。
   * WebGPU 要求每行字节数为 256 的倍数，因此回读缓冲带行间距，之后重排为紧凑 RGBA。
   */
  override async readTexturePixels(texture: Texture, options: ReadPixelsOptions = {}): Promise<Uint8Array> {
    const rect = resolveReadRect(texture, options);
    assert((texture.usage & TextureUsage.COPY_SRC) !== 0, "readTexturePixels 需要纹理带 COPY_SRC 用途");
    const tex = texture as WebGPUTexture;
    const tight = rect.width * 4;
    const bytesPerRow = align256(tight);
    const buffer = this.gpu.createBuffer({
      label: "unidraw-readback",
      size: bytesPerRow * rect.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.gpu.createCommandEncoder({ label: "unidraw-readback" });
    encoder.copyTextureToBuffer(
      { texture: tex.gpuTexture, origin: { x: rect.x, y: rect.y } },
      { buffer, bytesPerRow, rowsPerImage: rect.height },
      { width: rect.width, height: rect.height },
    );
    this.gpu.queue.submit([encoder.finish()]);
    this.markSubmitted();

    await buffer.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buffer.getMappedRange());
    const out = new Uint8Array(tight * rect.height);
    repackRows(src, bytesPerRow, rect.width, rect.height, out);
    buffer.unmap();
    buffer.destroy();
    if (rect.bgra) swizzleBgraToRgbaInPlace(out);
    return out;
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
    this.markSubmitted();
  }

  protected override executeOps(ops: readonly CommandOp[]): void {
    const native = this.gpu.createCommandEncoder();
    this.encodeOps(native, ops);
    this.gpu.queue.submit([native.finish()]);
    this.markSubmitted();
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
          if (group) {
            if (op.offsets && op.offsets.length > 0) pass.setBindGroup(op.index, group, op.offsets as number[]);
            else pass.setBindGroup(op.index, group);
          }
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

// 保持模块公共入口不变（createDevice 等仍可从本文件导入这些符号）
export { WEBGPU_INTERNAL_DEPTH_FORMAT } from "./constants.js";
export { isWebGPUSupported } from "./gpuUtils.js";
export type { WebGPUDeviceOptions } from "./types.js";
