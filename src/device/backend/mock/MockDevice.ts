/**
 * MockDevice —— 无头 CPU 后端。
 *
 * 与 WebGL2/WebGPU 共享同一套 IDevice API 与统一命令流：
 * - 资源对象保持 CPU 拷贝；
 * - submit 把命令执行在“伪帧缓冲”状态模型上；
 * - 记录每次 draw 的完整状态快照，供单元/集成测试断言；
 * - 让无浏览器/无 GPU 环境（CI、SSR、纯逻辑验证）也能跑通管线。
 */

import { Device, type DeviceLimits } from "../../Device.js";
import { BindGroup, BindGroupLayout, Buffer, Program, RenderPipeline, Sampler, Texture, TextureView } from "../../resources.js";
import type {
  BindGroupDescriptor,
  BindGroupLayoutDescriptor,
  BindGroupResource,
  BufferDescriptor,
  ProgramDescriptor,
  RenderPipelineDescriptor,
  SamplerDescriptor,
  TextureDescriptor,
  TextureUploadOptions,
} from "../../descriptors.js";
import { assert } from "../../../util/assert.js";
import { UnidrawError } from "../../../util/assert.js";
import type { CommandOp } from "../../../command/ops.js";
import { textureFormatInfo, vertexFormatInfo } from "../../../gpu/formats.js";
import { isDepthFormat, type IndexFormat, type TextureFormat } from "../../../gpu/types.js";

export const MOCK_CANVAS_FORMAT: TextureFormat = "rgba8unorm";

// ---------------------------------------------------------------------------
// Mock 资源
// ---------------------------------------------------------------------------

class MockBuffer extends Buffer {
  readonly data: Uint8Array;

  constructor(device: MockDevice, desc: BufferDescriptor) {
    super(desc);
    assert(desc.size >= 0, "Buffer size 不能为负");
    this.data = new Uint8Array(desc.size);
    device.register(this);
  }

  override write(data: ArrayBufferView | ArrayBuffer, offset = 0): void {
    assert(offset >= 0 && offset <= this.data.byteLength, "write offset 非法");
    const bytes =
      data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    assert(offset + bytes.byteLength <= this.data.byteLength, `Buffer 写入越界: offset=${offset} len=${bytes.byteLength} size=${this.size}`);
    this.data.set(bytes, offset);
  }

  protected destroyNative(): void {}
}

class MockTexture extends Texture {
  /** 颜色纹理的 CPU 像素；深度/浮点纹理为 null */
  readonly pixels: Uint8Array | null;
  readonly bpp: number;

  constructor(device: MockDevice, desc: TextureDescriptor) {
    super(desc);
    assert(desc.width >= 1 && desc.height >= 1, "纹理尺寸必须 >=1");
    this.bpp = textureFormatInfo(desc.format).bytesPerTexel;
    this.pixels = isDepthFormat(desc.format) ? null : new Uint8Array(desc.width * desc.height * this.bpp);
    device.register(this);
  }

  protected override createDefaultView(): TextureView {
    return new MockTextureView(this);
  }

  override upload(data: ArrayBufferView, options: TextureUploadOptions = {}): void {
    if (!this.pixels) return;
    const x = options.x ?? 0;
    const y = options.y ?? 0;
    const width = options.width ?? this.width;
    const height = options.height ?? this.height;
    const bytesPerRow = options.bytesPerRow ?? width * this.bpp;
    assert(width >= 1 && height >= 1 && x >= 0 && y >= 0, "upload 区域非法");
    assert(x + width <= this.width && y + height <= this.height, "upload 区域越界");
    const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    assert((height - 1) * bytesPerRow + width * this.bpp <= src.byteLength, "upload 数据长度不足");
    for (let row = 0; row < height; row++) {
      const srcStart = row * bytesPerRow;
      const dstStart = ((y + row) * this.width + x) * this.bpp;
      for (let b = 0; b < width * this.bpp; b++) {
        this.pixels[dstStart + b] = src[srcStart + b]!;
      }
    }
  }

  override generateMipmaps(): void {}

  protected destroyNative(): void {}
}

class MockTextureView extends TextureView {
  constructor(texture: Texture) {
    super(texture);
  }
}

class MockSampler extends Sampler {
  constructor(device: MockDevice, desc: SamplerDescriptor) {
    super(desc);
    device.register(this);
  }
  protected destroyNative(): void {}
}

class MockProgram extends Program {
  constructor(device: MockDevice, desc: ProgramDescriptor) {
    super(desc);
    device.register(this);
  }
  protected destroyNative(): void {}
}

class MockBindGroupLayout extends BindGroupLayout {
  constructor(device: MockDevice, desc: BindGroupLayoutDescriptor) {
    super(desc);
    device.register(this);
  }
  protected destroyNative(): void {}
}

class MockBindGroup extends BindGroup {
  constructor(device: MockDevice, desc: BindGroupDescriptor) {
    super(desc);
    const byBinding = new Map(desc.layout.entries.map((e) => [e.binding, e]));
    for (const entry of desc.entries) {
      const layout = byBinding.get(entry.binding);
      assert(layout, `bind group 包含布局未声明的 binding=${entry.binding}`);
      assertResourceType(layout.type, entry.resource, entry.binding);
    }
    device.register(this);
  }
  protected destroyNative(): void {}
}

function assertResourceType(type: "uniform-buffer" | "texture" | "sampler", resource: BindGroupResource, binding: number): void {
  if (type === "uniform-buffer") assert(resource instanceof Buffer, `binding ${binding} 应为 Buffer（uniform）`);
  else if (type === "sampler") assert(resource instanceof Sampler, `binding ${binding} 应为 Sampler`);
  else assert(resource instanceof TextureView, `binding ${binding} 应为 TextureView`);
}

class MockRenderPipeline extends RenderPipeline {
  constructor(device: MockDevice, desc: RenderPipelineDescriptor) {
    super(desc);
    assert(desc.program.supportsWebGL2 || desc.program.supportsWebGPU, "program 需要至少一种后端源码");
    assert(desc.targets.length >= 1, "pipeline 至少需要一个 color target");
    device.register(this);
  }
  protected destroyNative(): void {}
}

// ---------------------------------------------------------------------------
// Draw 记录
// ---------------------------------------------------------------------------

export interface MockVertexBufferBinding {
  slot: number;
  buffer: Buffer;
  offset: number;
}

export interface MockIndexBufferBinding {
  buffer: Buffer;
  format: IndexFormat;
  offset: number;
}

export interface MockDrawCall {
  kind: "draw" | "drawIndexed";
  passIndex: number;
  pipeline: RenderPipeline;
  bindGroups: (BindGroup | null)[];
  vertexBuffers: MockVertexBufferBinding[];
  indexBuffer: MockIndexBufferBinding | null;
  draw: {
    vertexCount?: number;
    /** drawIndexed 的索引数 */
    indexCount?: number;
    instanceCount: number;
    firstVertex: number;
    firstIndex: number;
    baseVertex: number;
    firstInstance: number;
  };
  viewport: { x: number; y: number; width: number; height: number };
  scissor: { x: number; y: number; width: number; height: number } | null;
}

// ---------------------------------------------------------------------------
// MockDevice
// ---------------------------------------------------------------------------

interface PassState {
  colorFormats: (TextureFormat | null)[];
  width: number;
  height: number;
}

export class MockDevice extends Device {
  private _drawCalls: MockDrawCall[] = [];
  private _passCount = 0;

  constructor() {
    super("mock", null, { kind: "mock", name: "MockDevice (headless)" });
  }

  override get limits(): DeviceLimits {
    return { maxVertexAttributes: 16, maxTextureUnits: 16, maxUniformBufferBindings: 16, maxTextureSize: 4096 };
  }

  // ---- 资源创建 -----------------------------------------------------------

  override createBuffer(desc: BufferDescriptor): Buffer {
    return new MockBuffer(this, desc);
  }
  override createTexture(desc: TextureDescriptor): Texture {
    return new MockTexture(this, desc);
  }
  override createSampler(desc: SamplerDescriptor): Sampler {
    return new MockSampler(this, desc);
  }
  override createProgram(desc: ProgramDescriptor): Program {
    return new MockProgram(this, desc);
  }
  override createBindGroupLayout(desc: BindGroupLayoutDescriptor): BindGroupLayout {
    return new MockBindGroupLayout(this, desc);
  }
  override createBindGroup(desc: BindGroupDescriptor): BindGroup {
    return new MockBindGroup(this, desc);
  }
  override createRenderPipeline(desc: RenderPipelineDescriptor): RenderPipeline {
    return new MockRenderPipeline(this, desc);
  }

  // ---- 查询 ---------------------------------------------------------------

  override async onSubmittedWorkDone(): Promise<void> {}

  override presentSize(): { width: number; height: number } {
    return { width: 0, height: 0 };
  }

  override canvasFormat(): TextureFormat | null {
    return MOCK_CANVAS_FORMAT;
  }

  /** 测试断言：已记录的 draw 调用（累积，可用 clearDrawCalls 清空）。 */
  get drawCalls(): readonly MockDrawCall[] {
    return this._drawCalls;
  }

  get passCount(): number {
    return this._passCount;
  }

  clearDrawCalls(): void {
    this._drawCalls = [];
    this._passCount = 0;
  }

  /** 读取颜色纹理的 CPU 像素（0..255）。 */
  readPixels(texture: Texture): Uint8Array | null {
    const mock = texture as unknown as MockTexture;
    if (!mock.pixels) return null;
    return new Uint8Array(mock.pixels);
  }

  // ---- 命令执行 -----------------------------------------------------------

  protected override executeOps(ops: readonly CommandOp[]): void {
    let pass: PassState | null = null;
    let boundPipeline: RenderPipeline | null = null;
    const bindGroups: (BindGroup | null)[] = [null, null, null, null];
    const vertexBuffers = new Map<number, MockVertexBufferBinding>();
    let indexBuffer: MockIndexBufferBinding | null = null;
    let viewport = { x: 0, y: 0, width: 0, height: 0 };
    let scissor: { x: number; y: number; width: number; height: number } | null = null;
    const resetPassState = () => {
      boundPipeline = null;
      bindGroups.fill(null);
      vertexBuffers.clear();
      indexBuffer = null;
      viewport = { x: 0, y: 0, width: 0, height: 0 };
      scissor = null;
    };

    for (const op of ops) {
      switch (op.k) {
        case "beginRenderPass": {
          const first = op.colorAttachments.find((a) => a !== null);
          const tex = first?.view?.texture;
          pass = {
            colorFormats: op.colorAttachments.map((a) => (a === null ? null : (a.view?.texture.format ?? MOCK_CANVAS_FORMAT))),
            width: tex?.width ?? 0,
            height: tex?.height ?? 0,
          };
          resetPassState();
          viewport = { x: 0, y: 0, width: pass.width, height: pass.height };
          this._passCount++;
          for (const att of op.colorAttachments) {
            if (att && att.loadOp === "clear" && att.view?.texture && att.clearValue) {
              this.clearAttachment(att.view.texture, att.clearValue);
            }
          }
          if (op.depthStencilAttachment?.depthLoadOp === "clear") {
            this.clearDepth(op.depthStencilAttachment.view?.texture ?? null, op.depthStencilAttachment.depthClearValue ?? 1);
          }
          break;
        }
        case "endRenderPass":
          pass = null;
          resetPassState();
          break;
        case "setPipeline": {
          assert(pass, "setPipeline 必须在 render pass 内");
          const pipeline = op.pipeline;
          for (const [i, target] of pipeline.descriptor.targets.entries()) {
            const actual = pass.colorFormats[i];
            assert(actual === null || actual === target.format, `pipeline color target[${i}] 格式 ${target.format} 与附件 ${actual ?? "canvas"} 不一致`);
          }
          boundPipeline = pipeline;
          break;
        }
        case "setBindGroup":
          assert(pass, "setBindGroup 必须在 render pass 内");
          bindGroups[op.index] = op.group;
          break;
        case "setVertexBuffer": {
          assert(pass, "setVertexBuffer 必须在 render pass 内");
          if (op.buffer) vertexBuffers.set(op.slot, { slot: op.slot, buffer: op.buffer, offset: op.offset });
          else vertexBuffers.delete(op.slot);
          break;
        }
        case "setIndexBuffer": {
          assert(pass, "setIndexBuffer 必须在 render pass 内");
          indexBuffer = op.buffer ? { buffer: op.buffer, format: op.format, offset: op.offset } : null;
          break;
        }
        case "setViewport":
          viewport = { x: op.x, y: op.y, width: op.width, height: op.height };
          break;
        case "setScissorRect":
          scissor = { x: op.x, y: op.y, width: op.width, height: op.height };
          break;
        case "draw":
        case "drawIndexed": {
          assert(pass, "draw 必须在 render pass 内");
          assert(boundPipeline, "draw 前必须 setPipeline");
          if (op.k === "drawIndexed") assert(indexBuffer, "drawIndexed 前必须 setIndexBuffer");
          this.validateVertexBindings(boundPipeline, vertexBuffers, op.k);
          this._drawCalls.push({
            kind: op.k,
            passIndex: this._passCount,
            pipeline: boundPipeline,
            bindGroups: [...bindGroups],
            vertexBuffers: [...vertexBuffers.values()],
            indexBuffer,
            draw: {
              vertexCount: op.k === "draw" ? op.vertexCount : undefined,
              indexCount: op.k === "drawIndexed" ? op.indexCount : undefined,
              instanceCount: op.instanceCount,
              firstVertex: op.k === "draw" ? op.firstVertex : 0,
              firstIndex: op.k === "drawIndexed" ? op.firstIndex : 0,
              baseVertex: op.k === "drawIndexed" ? op.baseVertex : 0,
              firstInstance: op.firstInstance,
            },
            viewport: { ...viewport },
            scissor: scissor ? { ...scissor } : null,
          });
          break;
        }
        case "pushDebugGroup":
        case "popDebugGroup":
          break;
        default: {
          const exhaustive: never = op;
          throw new UnidrawError(`[unidraw] 未知命令 op: ${JSON.stringify(exhaustive)}`);
        }
      }
    }
  }

  private validateVertexBindings(
    pipeline: RenderPipeline,
    bound: Map<number, MockVertexBufferBinding>,
    kind: "draw" | "drawIndexed",
  ): void {
    const { buffers } = pipeline.descriptor.vertex;
    for (let slot = 0; slot < buffers.length; slot++) {
      const layout = buffers[slot];
      if (!layout) continue;
      const binding = bound.get(slot);
      assert(binding, `vertex buffer slot ${slot} 未绑定`);
      if (kind === "drawIndexed" && layout.attributes.length === 0) continue;
      const maxAttrEnd = Math.max(0, ...layout.attributes.map((a) => a.offset + vertexFormatInfo(a.format).size));
      const needed = layout.arrayStride > 0 ? layout.arrayStride : maxAttrEnd;
      assert(binding.offset + needed <= binding.buffer.size, `vertex buffer slot ${slot} 尺寸不足（需要 >= ${needed} 字节）`);
    }
  }

  private clearAttachment(texture: Texture, color: { r: number; g: number; b: number; a: number }): void {
    const mock = texture as unknown as MockTexture;
    if (!mock.pixels) return;
    const bpp = mock.bpp;
    for (let i = 0; i < texture.width * texture.height; i++) {
      mock.pixels[i * bpp] = clampByte(color.r);
      mock.pixels[i * bpp + 1] = clampByte(color.g);
      mock.pixels[i * bpp + 2] = clampByte(color.b);
      mock.pixels[i * bpp + 3] = clampByte(color.a);
    }
  }

  private clearDepth(texture: Texture | null, _value: number): void {
    void texture;
    // Mock 不维护深度缓冲内容
  }

  protected destroyNative(): void {}
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}
