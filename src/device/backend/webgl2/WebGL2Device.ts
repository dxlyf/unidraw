import { Device, DeviceLimits } from "../../Device.js";
import { BindGroup, BindGroupLayout, Buffer, Program, RenderPipeline, Sampler, Texture, TextureView } from "../../resources.js";
import type { BindGroupDescriptor, BindGroupLayoutDescriptor, BufferDescriptor, ProgramDescriptor, RenderPipelineDescriptor, SamplerDescriptor, TextureDescriptor } from "../../descriptors.js";
import { assert, UnidrawError } from "../../../util/assert.js";
import type { CommandOp } from "../../../command/ops.js";
import { bindGroupLayoutCacheKey } from "../../descriptors.js";
import type { ColorClearValue } from "../../../gpu/types.js";
import { vertexFormatInfo, INDEX_FORMAT_BYTES } from "../../../gpu/formats.js";
import type { IndexFormat, TextureFormat } from "../../../gpu/types.js";
import type { GL } from "./glUtils.js";
import { BLEND_FACTORS, BLEND_OPS, COMPARE, INDEX_TYPES, TOPOLOGY_GL } from "./constants.js";
import { GLBindGroup } from "./resources/GLBindGroup.js";
import { GLBindGroupLayout } from "./resources/GLBindGroupLayout.js";
import { GLBuffer } from "./resources/GLBuffer.js";
import { GLProgram } from "./resources/GLProgram.js";
import { GLRenderPipeline } from "./resources/GLRenderPipeline.js";
import { GLSampler } from "./resources/GLSampler.js";
import { GLTexture } from "./resources/GLTexture.js";
import { attributeGLType, describeRenderer } from "./glUtils.js";


// ---------------------------------------------------------------------------
// Device
// ---------------------------------------------------------------------------
export class WebGL2Device extends Device {
  readonly gl: GL;
  private _uniformBindingCursor = 0;
  private _textureUnitCursor = 0;
  private readonly _vaos = new Map<string, WebGLVertexArrayObject>();
  private readonly _fbos = new Map<string, WebGLFramebuffer>();
  private readonly _layoutCache = new Map<string, GLBindGroupLayout>();
  private readonly _uboFree: number[] = [];
  private readonly _texFree: number[] = [];
  private _scissorEnabled = false;
  private _limits: DeviceLimits | null = null;

  constructor(canvas: HTMLCanvasElement, options: { antialias?: boolean; alpha?: boolean } = {}) {
    const attrs: WebGLContextAttributes = {
      depth: true,
      stencil: false,
      antialias: options.antialias ?? true,
      alpha: options.alpha ?? false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
      failIfMajorPerformanceCaveat: false,
    };
    const gl = canvas.getContext("webgl2", attrs);
    if (!gl) throw new UnidrawError("无法创建 WebGL2 上下文：当前环境不支持 WebGL2");
    super("webgl2", canvas, { kind: "webgl2", name: `WebGL2 · ${describeRenderer(gl)}`, adapter: describeRenderer(gl) });
    this.gl = gl as WebGL2RenderingContext;
    this._textureUnitCursor = 1; // 单元 0 保留给内部操作
  }

  override get limits(): DeviceLimits {
    if (!this._limits) {
      const gl = this.gl;
      this._limits = {
        maxVertexAttributes: gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number,
        maxTextureUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) as number,
        maxUniformBufferBindings: gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS) as number,
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      };
    }
    return this._limits;
  }

  // -------------------------------------------------------------------------
  // 资源创建
  // -------------------------------------------------------------------------

  override createBuffer(desc: BufferDescriptor): Buffer {
    return new GLBuffer(this, desc);
  }

  override createTexture(desc: TextureDescriptor): Texture {
    assert(desc.format !== "bgra8unorm" && desc.format !== "bgra8unorm-srgb", "WebGL2 后端不支持 bgra 纹理格式");
    return new GLTexture(this, desc);
  }

  override createSampler(desc: SamplerDescriptor): Sampler {
    return new GLSampler(this, desc);
  }

  override createProgram(desc: ProgramDescriptor): Program {
    return new GLProgram(this, desc);
  }

  override createBindGroupLayout(desc: BindGroupLayoutDescriptor): BindGroupLayout {
    // 内容去重：相同布局共享同一组 UBO binding point / 纹理单元，
    // 防止大量同构材质耗尽有限的 GL binding 资源
    const key = bindGroupLayoutCacheKey(desc);
    const cached = this._layoutCache.get(key);
    if (cached) return cached;
    const layout = new GLBindGroupLayout(this, desc);
    this._layoutCache.set(key, layout);
    return layout;
  }

  override createBindGroup(desc: BindGroupDescriptor): BindGroup {
    return new GLBindGroup(this, desc);
  }

  override createRenderPipeline(desc: RenderPipelineDescriptor): RenderPipeline {
    return new GLRenderPipeline(this, desc);
  }

  allocateUniformBinding(): number {
    const reused = this._uboFree.pop();
    if (reused !== undefined) return reused;
    const point = this._uniformBindingCursor++;
    assert(point < this.limits.maxUniformBufferBindings, "UBO binding point 耗尽");
    return point;
  }

  allocateTextureUnit(): number {
    const reused = this._texFree.pop();
    if (reused !== undefined) return reused;
    const unit = this._textureUnitCursor++;
    assert(unit < this.limits.maxTextureUnits - 1, "纹理单元耗尽（保留 1 个给内部操作）");
    return unit;
  }

  freeUniformBinding(point: number): void {
    this._uboFree.push(point);
  }

  freeTextureUnit(unit: number): void {
    this._texFree.push(unit);
  }

  /** 布局销毁时从缓存移除（避免复用已销毁布局）。 */
  dropLayoutCache(layout: BindGroupLayout): void {
    for (const [key, value] of this._layoutCache) {
      if (value === layout) this._layoutCache.delete(key);
    }
  }

  // -------------------------------------------------------------------------
  // 查询
  // -------------------------------------------------------------------------

  override async onSubmittedWorkDone(): Promise<void> {
    this.gl.flush();
  }

  override presentSize(): { width: number; height: number } {
    const c = this.canvas;
    return { width: c?.width ?? 0, height: c?.height ?? 0 };
  }

  override canvasFormat(): TextureFormat | null {
    return "rgba8unorm";
  }

  // -------------------------------------------------------------------------
  // 命令执行
  // -------------------------------------------------------------------------

  protected override executeOps(ops: readonly CommandOp[]): void {
    const gl = this.gl;
    let inPass = false;
    let currentPipeline: GLRenderPipeline | null = null;
    const groups: (GLBindGroup | null)[] = [null, null, null, null];
    const vertexBuffers = new Map<number, { buffer: GLBuffer; offset: number }>();
    let indexBuffer: { buffer: GLBuffer; format: IndexFormat; offset: number } | null = null;
    let targetWidth = 0;
    let targetHeight = 0;
    /** 当前 pass 的附件高度（scissor/viewport 的 Y 翻转用） */
    let passHeight = 0;

    const resetPass = () => {
      currentPipeline = null;
      groups.fill(null);
      vertexBuffers.clear();
      indexBuffer = null;
    };

    for (const op of ops) {
      switch (op.k) {
        case "beginRenderPass": {
          assert(!inPass, "beginRenderPass 嵌套非法");
          const colorAtt = op.colorAttachments[0];
          const colorTex = colorAtt?.view?.texture as GLTexture | undefined;
          const toCanvas = colorAtt === null || colorAtt?.view === null;
          const depthAtt = op.depthStencilAttachment;
          const depthTex = depthAtt?.view?.texture as GLTexture | undefined;
          const scissorWas = this._scissorEnabled;

          if (toCanvas) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            targetWidth = this.canvas?.width ?? 0;
            targetHeight = this.canvas?.height ?? 0;
          } else {
            const fb = this.getFramebuffer(colorTex ?? null, depthTex ?? null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            const count = op.colorAttachments.filter((a) => a !== null).length || 1;
            const bufs: number[] = [];
            for (let i = 0; i < count; i++) bufs.push(gl.COLOR_ATTACHMENT0 + i);
            gl.drawBuffers(bufs);
            targetWidth = colorTex?.width ?? 0;
            targetHeight = colorTex?.height ?? 0;
          }
          passHeight = targetHeight;

          // 清屏不受 scissor 影响
          if (scissorWas) gl.disable(gl.SCISSOR_TEST);
          gl.depthMask(true);
          const clearColor = colorAtt && colorAtt.loadOp === "clear";
          if (colorAtt && clearColor) {
            const c: ColorClearValue | undefined = colorAtt.clearValue;
            gl.clearColor(c?.r ?? 0, c?.g ?? 0, c?.b ?? 0, c?.a ?? 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
          }
          const clearDepth = depthAtt?.view === null && depthAtt.depthLoadOp === "clear";
          if (clearDepth) {
            gl.clearDepth(depthAtt?.depthClearValue ?? 1);
            gl.clear(gl.DEPTH_BUFFER_BIT);
          }
          if (scissorWas) {
            gl.enable(gl.SCISSOR_TEST);
            this._scissorEnabled = true;
          }

          inPass = true;
          resetPass();
          gl.viewport(0, 0, targetWidth, targetHeight);
          gl.disable(gl.SCISSOR_TEST);
          this._scissorEnabled = false;
          break;
        }
        case "endRenderPass": {
          assert(inPass, "endRenderPass 无对应 beginRenderPass");
          inPass = false;
          resetPass();
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.disable(gl.SCISSOR_TEST);
          this._scissorEnabled = false;
          break;
        }
        case "setPipeline": {
          assert(inPass, "setPipeline 必须在 render pass 内");
          const p = op.pipeline as GLRenderPipeline;
          gl.useProgram(p.glProgram.linkedProgram());
          this.applyPipelineState(p);
          currentPipeline = p;
          break;
        }
        case "setBindGroup": {
          assert(inPass, "setBindGroup 必须在 render pass 内");
          const bg = op.group as GLBindGroup | null;
          groups[op.index] = bg;
          if (bg) this.bindGroup(bg);
          break;
        }
        case "setVertexBuffer": {
          assert(inPass, "setVertexBuffer 必须在 render pass 内");
          if (op.buffer) vertexBuffers.set(op.slot, { buffer: op.buffer as GLBuffer, offset: op.offset });
          else vertexBuffers.delete(op.slot);
          break;
        }
        case "setIndexBuffer": {
          assert(inPass, "setIndexBuffer 必须在 render pass 内");
          indexBuffer = op.buffer ? { buffer: op.buffer as GLBuffer, format: op.format, offset: op.offset } : null;
          break;
        }
        case "setViewport": {
          // 统一 API/WebGPU 约定：左上原点；GL 原点在左下 → 翻转 Y
          const vpY = passHeight - (op.y + op.height);
          gl.viewport(op.x, vpY, op.width, op.height);
          break;
        }
        case "setScissorRect": {
          gl.enable(gl.SCISSOR_TEST);
          this._scissorEnabled = true;
          const scY = passHeight - (op.y + op.height);
          gl.scissor(op.x, scY, op.width, op.height);
          break;
        }
        case "draw":
        case "drawIndexed": {
          assert(inPass && currentPipeline, "draw 前必须 setPipeline");
          this.drawPrimitive(currentPipeline, indexBuffer, op, vertexBuffers);
          break;
        }
        case "pushDebugGroup":
        case "popDebugGroup":
          break;
        default: {
          const exhaustive: never = op;
          throw new UnidrawError(`[unidraw] 未知命令 op：${JSON.stringify(exhaustive)}`);
        }
      }
    }
  }

  /** 应用管线静态状态（深度/剔除/混合）。 */
  private applyPipelineState(p: GLRenderPipeline): void {
    const gl = this.gl;
    const d = p.descriptor;
    const ds = d.depthStencil;
    if (ds) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(COMPARE[ds.depthCompare]);
      gl.depthMask(ds.depthWriteEnabled);
    } else {
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
    }
    const cull = d.primitive?.cullMode ?? "none";
    if (cull === "none") {
      gl.disable(gl.CULL_FACE);
    } else {
      gl.enable(gl.CULL_FACE);
      gl.cullFace(cull === "back" ? gl.BACK : gl.FRONT);
      gl.frontFace((d.primitive?.frontFace ?? "ccw") === "ccw" ? gl.CCW : gl.CW);
    }
    const target = d.targets[0];
    const blend = target?.blend;
    if (blend) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(
        BLEND_FACTORS[blend.color.srcFactor],
        BLEND_FACTORS[blend.color.dstFactor],
        BLEND_FACTORS[blend.alpha.srcFactor],
        BLEND_FACTORS[blend.alpha.dstFactor],
      );
      gl.blendEquationSeparate(BLEND_OPS[blend.color.operation], BLEND_OPS[blend.alpha.operation]);
      const mask = target.writeMask ?? 0xf;
      gl.colorMask((mask & 1) !== 0, (mask & 2) !== 0, (mask & 4) !== 0, (mask & 8) !== 0);
    } else {
      gl.disable(gl.BLEND);
      gl.colorMask(true, true, true, true);
    }
    // sampler uniform 指向每个 layout 分配的纹理单元
    for (const layout of d.bindGroupLayouts) {
      const glLayout = layout as GLBindGroupLayout;
      let texIdx = 0;
      for (const entry of layout.entries) {
        if (entry.type !== "texture") continue;
        const name = entry.name;
        const loc = name ? p.glProgram.uniformLocation(name) : null;
        if (loc) gl.uniform1i(loc, glLayout.textureUnits[texIdx]!);
        texIdx++;
      }
    }
  }

  private bindGroup(bg: GLBindGroup): void {
    const gl = this.gl;
    const layout = bg.descriptor.layout as GLBindGroupLayout;
    const byBinding = new Map(bg.descriptor.entries.map((e) => [e.binding, e.resource]));
    // UBO
    let uboIdx = 0;
    for (const entry of layout.entries) {
      if (entry.type !== "uniform-buffer") continue;
      const res = byBinding.get(entry.binding);
      if (res instanceof Buffer) gl.bindBufferBase(gl.UNIFORM_BUFFER, layout.uboPoints[uboIdx]!, (res as GLBuffer).glBuffer);
      uboIdx++;
    }
    // texture + sampler（按 entry 顺序配对）
    const textures = layout.entries.filter((e) => e.type === "texture");
    const samplers = layout.entries.filter((e) => e.type === "sampler");
    textures.forEach((texEntry, i) => {
      const unit = layout.textureUnits[i]!;
      const res = byBinding.get(texEntry.binding);
      gl.activeTexture(gl.TEXTURE0 + unit);
      if (res instanceof TextureView) gl.bindTexture(gl.TEXTURE_2D, (res.texture as GLTexture).glTexture);
      else gl.bindTexture(gl.TEXTURE_2D, null);
      const samRes = samplers[i] ? byBinding.get(samplers[i]!.binding) : undefined;
      if (samRes instanceof Sampler) gl.bindSampler(unit, (samRes as GLSampler).glSampler);
      else gl.bindSampler(unit, null);
    });
  }

  private drawPrimitive(
    pipeline: GLRenderPipeline,
    index: { buffer: GLBuffer; format: IndexFormat; offset: number } | null,
    op: Extract<CommandOp, { k: "draw" } | { k: "drawIndexed" }>,
    vertexBuffers: Map<number, { buffer: GLBuffer; offset: number }>,
  ): void {
    const gl = this.gl;
    const topology = (pipeline.descriptor.primitive?.topology ?? "triangle-list") as string;
    const mode = TOPOLOGY_GL[topology]!;
    const baseVertex = op.k === "drawIndexed" ? op.baseVertex : 0;
    const key = this.vaoKey(pipeline, vertexBuffers, index?.buffer ?? null, baseVertex);
    let vao = this._vaos.get(key);
    if (!vao) {
      vao = gl.createVertexArray();
      if (!vao) throw new UnidrawError("createVertexArray 失败");
      this._vaos.set(key, vao);
      this.setupVao(pipeline, vertexBuffers, index?.buffer ?? null, baseVertex, vao);
    }
    gl.bindVertexArray(vao);
    if (op.k === "draw") {
      gl.drawArraysInstanced(mode, op.firstVertex, op.vertexCount, op.instanceCount);
    } else {
      if (!index) throw new UnidrawError("drawIndexed 需要 setIndexBuffer");
      const byteOffset = index.offset + op.firstIndex * INDEX_FORMAT_BYTES[index.format];
      gl.drawElementsInstanced(mode, op.indexCount, INDEX_TYPES[index.format], byteOffset, op.instanceCount);
    }
    gl.bindVertexArray(null);
  }

  private vaoKey(
    pipeline: GLRenderPipeline,
    vertexBuffers: Map<number, { buffer: GLBuffer; offset: number }>,
    indexBuffer: GLBuffer | null,
    baseVertex: number,
  ): string {
    const parts = [`p${pipeline.id}`, `b${baseVertex}`];
    const slots = [...vertexBuffers.keys()].sort((a, b) => a - b);
    for (const slot of slots) {
      const vb = vertexBuffers.get(slot)!;
      parts.push(`s${slot}:${vb.buffer.id}@${vb.offset}`);
    }
    parts.push(indexBuffer ? `i${indexBuffer.id}` : "i0");
    return parts.join("|");
  }

  private setupVao(
    pipeline: GLRenderPipeline,
    vertexBuffers: Map<number, { buffer: GLBuffer; offset: number }>,
    indexBuffer: GLBuffer | null,
    baseVertex: number,
    vao: WebGLVertexArrayObject,
  ): void {
    const gl = this.gl;
    gl.bindVertexArray(vao);
    for (let loc = 0; loc < this.limits.maxVertexAttributes; loc++) gl.disableVertexAttribArray(loc);
    const buffers = pipeline.descriptor.vertex.buffers;
    for (let slot = 0; slot < buffers.length; slot++) {
      const layout = buffers[slot];
      const binding = layout ? vertexBuffers.get(slot) : undefined;
      if (!layout || !binding) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, binding.buffer.glBuffer);
      const stride = layout.arrayStride;
      const divisor = (layout.stepMode ?? "vertex") === "instance" ? 1 : 0;
      for (const attr of layout.attributes) {
        const info = vertexFormatInfo(attr.format);
        const baseAdd = baseVertex * (stride > 0 ? stride : info.size);
        const offset = binding.offset + attr.offset + baseAdd;
        gl.enableVertexAttribArray(attr.location);
        const glType = attributeGLType(this.gl, info.glType);
        if (info.integer) {
          gl.vertexAttribIPointer(attr.location, info.components, glType, stride, offset);
        } else {
          gl.vertexAttribPointer(attr.location, info.components, glType, info.normalized, stride, offset);
        }
        gl.vertexAttribDivisor(attr.location, divisor);
      }
    }
    if (indexBuffer) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer.glBuffer);
    gl.bindVertexArray(null);
  }

  private getFramebuffer(color: GLTexture | null, depth: GLTexture | null): WebGLFramebuffer {
    const gl = this.gl;
    const key = `c${color ? color.id : 0}d${depth ? depth.id : 0}`;
    const cached = this._fbos.get(key);
    if (cached) return cached;
    const fb = gl.createFramebuffer();
    assert(fb, "createFramebuffer 失败");
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    if (color) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color.glTexture, 0);
    if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth.glTexture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    assert(status === gl.FRAMEBUFFER_COMPLETE, `Framebuffer 不完整：0x${status.toString(16)}`);
    this._fbos.set(key, fb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fb;
  }

  protected destroyNative(): void {
    for (const vao of this._vaos.values()) this.gl.deleteVertexArray(vao);
    this._vaos.clear();
    for (const fb of this._fbos.values()) this.gl.deleteFramebuffer(fb);
    this._fbos.clear();
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
