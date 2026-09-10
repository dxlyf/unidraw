import { Device, DeviceLimits } from "../../Device.js";
import { BindGroup, BindGroupLayout, Buffer, Program, RenderPipeline, Sampler, Texture } from "../../resources.js";
import type { BindGroupDescriptor, BindGroupLayoutDescriptor, BufferDescriptor, ProgramDescriptor, RenderPipelineDescriptor, SamplerDescriptor, TextureDescriptor } from "../../descriptors.js";
import { assert } from "../../../util/assert.js";
import { UnidrawError } from "../../../util/assert.js";
import { readDynamicOffsets } from "../../../command/ops.js";
import type { CommandOp } from "../../../command/ops.js";
import { vertexFormatInfo } from "../../../gpu/formats.js";
import type { TextureFormat } from "../../../gpu/types.js";
import type { MockDrawCall, MockIndexBufferBinding, MockVertexBufferBinding, PassState } from "./types.js";
import { MOCK_CANVAS_FORMAT } from "./constants.js";
import { MockBindGroup } from "./resources/MockBindGroup.js";
import { MockBindGroupLayout } from "./resources/MockBindGroupLayout.js";
import { MockBuffer } from "./resources/MockBuffer.js";
import { MockProgram } from "./resources/MockProgram.js";
import { MockRenderPipeline } from "./resources/MockRenderPipeline.js";
import { MockSampler } from "./resources/MockSampler.js";
import { MockTexture } from "./resources/MockTexture.js";
import { clampByte } from "./gpuUtils.js";
import { resolveReadRect, swizzleBgraToRgbaInPlace, type ReadPixelsOptions } from "../../readback.js";

export class MockDevice extends Device {
  private _drawCalls: MockDrawCall[] = [];
  private _passCount = 0;

  constructor() {
    super("mock", null, { kind: "mock", name: "MockDevice (headless)" });
  }

  override get limits(): DeviceLimits {
    return {
      maxVertexAttributes: 16,
      maxTextureUnits: 16,
      maxUniformBufferBindings: 16,
      maxTextureSize: 4096,
      minUniformBufferOffsetAlignment: 256,
      maxSamples: 4,
    };
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
  protected override createProgramNative(desc: ProgramDescriptor): Program {
    return new MockProgram(this, desc);
  }
  override createBindGroupLayout(desc: BindGroupLayoutDescriptor): BindGroupLayout {
    return new MockBindGroupLayout(this, desc);
  }
  override createBindGroup(desc: BindGroupDescriptor): BindGroup {
    return new MockBindGroup(this, desc);
  }
  protected override createRenderPipelineNative(desc: RenderPipelineDescriptor): RenderPipeline {
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

  /** 统一回读接口：返回左上原点、紧凑 8bit RGBA 的子区域。 */
  override async readTexturePixels(texture: Texture, options: ReadPixelsOptions = {}): Promise<Uint8Array> {
    const mock = texture as unknown as MockTexture;
    assert(mock.pixels, "Mock 纹理没有 CPU 像素（深度/浮点格式不可回读）");
    const rect = resolveReadRect(texture, options);
    const out = new Uint8Array(rect.width * rect.height * 4);
    for (let row = 0; row < rect.height; row++) {
      const src = ((rect.y + row) * texture.width + rect.x) * 4;
      out.set(mock.pixels.subarray(src, src + rect.width * 4), row * rect.width * 4);
    }
    if (rect.bgra) swizzleBgraToRgbaInPlace(out);
    return out;
  }

  // ---- 命令执行 -----------------------------------------------------------

  protected override executeOps(ops: readonly CommandOp[]): void {
    let pass: PassState | null = null;
    let boundPipeline: RenderPipeline | null = null;
    const bindGroups: (BindGroup | null)[] = [null, null, null, null];
    const bindGroupOffsets: (number[] | null)[] = [null, null, null, null];
    const vertexBuffers = new Map<number, MockVertexBufferBinding>();
    let indexBuffer: MockIndexBufferBinding | null = null;
    let viewport = { x: 0, y: 0, width: 0, height: 0 };
    let scissor: { x: number; y: number; width: number; height: number } | null = null;
    const resetPassState = () => {
      boundPipeline = null;
      bindGroups.fill(null);
      bindGroupOffsets.fill(null);
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
          bindGroupOffsets[op.index] = op.offsetCount > 0 ? readDynamicOffsets(op) : null;
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
            bindGroupOffsets: bindGroupOffsets.map((o) => (o ? [...o] : null)),
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

// 保持模块公共入口不变（测试等仍可从本文件导入这些符号）
export { MOCK_CANVAS_FORMAT } from "./constants.js";
export type { MockDrawCall, MockIndexBufferBinding, MockVertexBufferBinding } from "./types.js";
