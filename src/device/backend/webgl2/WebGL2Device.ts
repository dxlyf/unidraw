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
import { attributeGLType, describeRenderer, textureGLParams } from "./glUtils.js";
import { flipRowsInPlace, resolveReadRect, swizzleBgraToRgbaInPlace, type ReadPixelsOptions } from "../../readback.js";


// ---------------------------------------------------------------------------
// Device
// ---------------------------------------------------------------------------
export class WebGL2Device extends Device {
  readonly gl: GL;
  private _uniformBindingCursor = 0;
  private _textureUnitCursor = 0;
  private readonly _vaos = new Map<string, WebGLVertexArrayObject>();
  private readonly _fbos = new Map<string, WebGLFramebuffer>();
  /** MSAA renderbuffer 缓存（key: 格式|尺寸|采样数） */
  private readonly _renderbuffers = new Map<string, WebGLRenderbuffer>();
  /** 当前绑定的 VAO（避免重复 bindVertexArray） */
  private _boundVao: WebGLVertexArrayObject | null = null;
  /** 上一次绘制用的 VAO 及其指纹（大量 draw 时跳过 key 字符串构造） */
  private readonly _lastVao = {
    vao: null as WebGLVertexArrayObject | null,
    pipeline: null as GLRenderPipeline | null,
    indexBuffer: null as GLBuffer | null,
    baseVertex: 0,
    vertexSlot0: null as GLBuffer | null,
    vertexOffset0: 0,
    vertexCount: -1,
  };
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
        minUniformBufferOffsetAlignment:
          (gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) as number | null) ?? 256,
        maxSamples: (gl.getParameter(gl.MAX_SAMPLES) as number | null) ?? 1,
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

  protected override createProgramNative(desc: ProgramDescriptor): Program {
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

  protected override createRenderPipelineNative(desc: RenderPipelineDescriptor): RenderPipeline {
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

  /**
   * 纹理回读：绑定临时 FBO → `readPixels` → 翻转 Y（GL 原点在左下）。
   * 注意：会临时切换绑定的 framebuffer，读取后恢复。
   */
  override async readTexturePixels(texture: Texture, options: ReadPixelsOptions = {}): Promise<Uint8Array> {
    const gl = this.gl;
    const rect = resolveReadRect(texture, options);
    const tex = texture as GLTexture;
    const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const fb = this.getFramebuffer(tex, null);
    const out = new Uint8Array(rect.width * rect.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    // GL 的 readPixels 原点在左下：把「左上 y」换算成 GL 的行起点
    gl.readPixels(rect.x, texture.height - (rect.y + rect.height), rect.width, rect.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
    flipRowsInPlace(out, rect.width, rect.height);
    if (rect.bgra) swizzleBgraToRgbaInPlace(out);
    return out;
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
    /** 当前 pass 若是 MSAA，则记录源 FBO 与解析目标（endRenderPass 时 blit） */
    let msaaSourceFb: WebGLFramebuffer | null = null;
    let msaaResolveTarget: Texture | null = null;
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
          // 没有任何颜色附件（`colorAttachments: []`）= 只写深度的 pass（阴影贴图）
          const depthOnly = op.colorAttachments.length === 0;
          const toCanvas = !depthOnly && (colorAtt === null || colorAtt?.view === null);
          const depthAtt = op.depthStencilAttachment;
          const depthTex = depthAtt?.view?.texture as GLTexture | undefined;
          const scissorWas = this._scissorEnabled;

          if (toCanvas) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            targetWidth = this.canvas?.width ?? 0;
            targetHeight = this.canvas?.height ?? 0;
          } else {
            const msaa = (colorTex?.sampleCount ?? 1) > 1 || (depthTex?.sampleCount ?? 1) > 1;
            const fb = msaa
              ? this.getMsaaFramebuffer(colorTex ?? null, depthTex ?? null)
              : this.getFramebuffer(colorTex ?? null, depthTex ?? null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            msaaSourceFb = msaa ? fb : null;
            msaaResolveTarget = msaa ? (colorAtt?.resolveTo?.texture ?? null) : null;
            const count = op.colorAttachments.filter((a) => a !== null).length;
            if (count === 0) {
              // 深度专用 FBO：不能引用不存在的颜色附件
              assert(depthTex != null, "没有颜色附件时必须提供深度附件");
              gl.drawBuffers([gl.NONE]);
            } else {
              const bufs: number[] = [];
              for (let i = 0; i < count; i++) bufs.push(gl.COLOR_ATTACHMENT0 + i);
              gl.drawBuffers(bufs);
            }
            targetWidth = colorTex?.width ?? depthTex?.width ?? 0;
            targetHeight = colorTex?.height ?? depthTex?.height ?? 0;
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
          const clearDepth = depthAtt != null && depthAtt.depthLoadOp === "clear";
          if (clearDepth) {
            // 注意：无论深度附件是 canvas 默认深度还是**显式深度纹理**，都必须清 ——
            // 显式纹理上一次 pass 的深度会残留，导致本次 pass 的物体被“幽灵深度”挡住
            // （离屏渲染/ID 拾取在 WebGL2 上表现为物体缺失或拾取到错误对象）。
            gl.clearDepth(depthAtt.depthClearValue ?? 1);
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
          // MSAA：把多重采样附件解析到目标纹理（WebGPU 的 resolveTarget 语义）
          if (msaaSourceFb && msaaResolveTarget) {
            this.resolveMsaa(msaaSourceFb, msaaResolveTarget);
          }
          msaaSourceFb = null;
          msaaResolveTarget = null;
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.disable(gl.SCISSOR_TEST);
          this._scissorEnabled = false;
          break;
        }
        case "setPipeline": {
          assert(inPass, "setPipeline 必须在 render pass 内");
          const p = op.pipeline as GLRenderPipeline;
          // 状态最小化：同一 pass 内重复设置同一管线时跳过（useProgram + 状态设置）
          if (currentPipeline !== p) {
            gl.useProgram(p.glProgram.linkedProgram());
            this.applyPipelineState(p);
            currentPipeline = p;
          }
          break;
        }
        case "setBindGroup": {
          assert(inPass, "setBindGroup 必须在 render pass 内");
          const bg = op.group as GLBindGroup | null;
          groups[op.index] = bg;
          if (bg) this.bindGroup(bg, op);
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

  private bindGroup(bg: GLBindGroup, op: { offset0: number; offset1: number; offsetCount: number }): void {
    const gl = this.gl;
    const layout = bg.descriptor.layout as GLBindGroupLayout;
    const byBinding = new Map(bg.descriptor.entries.map((e) => [e.binding, e]));
    // UBO（动态偏移 entry 按顺序消费内联偏移；无偏移时退化为 bindBufferBase）
    let uboIdx = 0;
    let dynIdx = 0;
    for (const entry of layout.entries) {
      if (entry.type !== "uniform-buffer") continue;
      const binding = byBinding.get(entry.binding);
      const res = binding?.resource;
      if (res instanceof Buffer) {
        const glBuffer = (res as GLBuffer).glBuffer;
        const dynamic = entry.hasDynamicOffset === true;
        const dynOffset = dynamic ? (dynIdx === 0 ? op.offset0 : op.offset1) : 0;
        if (dynamic) dynIdx++;
        const base = binding?.offset ?? 0;
        if (dynamic || binding?.offset || binding?.size) {
          const size = binding?.size ?? Math.max(0, res.size - base);
          gl.bindBufferRange(gl.UNIFORM_BUFFER, layout.uboPoints[uboIdx]!, glBuffer, base + dynOffset, size);
        } else {
          gl.bindBufferBase(gl.UNIFORM_BUFFER, layout.uboPoints[uboIdx]!, glBuffer);
        }
      }
      uboIdx++;
    }
    // texture + sampler（按 entry 顺序配对）
    const textures = layout.entries.filter((e) => e.type === "texture");
    const samplers = layout.entries.filter((e) => e.type === "sampler");
    textures.forEach((texEntry, i) => {
      const unit = layout.textureUnits[i]!;
      const res = byBinding.get(texEntry.binding)?.resource;
      gl.activeTexture(gl.TEXTURE0 + unit);
      if (res instanceof TextureView) gl.bindTexture(gl.TEXTURE_2D, (res.texture as GLTexture).glTexture);
      else gl.bindTexture(gl.TEXTURE_2D, null);
      const samRes = samplers[i] ? byBinding.get(samplers[i]!.binding)?.resource : undefined;
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
    // 大量 draw 时最常见的形态是「同一 pipeline + 同一批缓冲 + 同一 baseVertex 连续绘制」，
    // 用一次性缓存跳过 VAO key 字符串构造与 Map 查询
    const cache = this._lastVao;
    let vao: WebGLVertexArrayObject | null;
    const simpleCase = vertexBuffers.size <= 1; // 多顶点流时退化为 key 查表，保证正确性
    if (
      simpleCase &&
      cache.vao &&
      cache.pipeline === pipeline &&
      cache.indexBuffer === (index?.buffer ?? null) &&
      cache.baseVertex === baseVertex &&
      cache.vertexSlot0 === (vertexBuffers.get(0)?.buffer ?? null) &&
      cache.vertexOffset0 === (vertexBuffers.get(0)?.offset ?? 0) &&
      cache.vertexCount === vertexBuffers.size
    ) {
      vao = cache.vao;
    } else {
      const key = this.vaoKey(pipeline, vertexBuffers, index?.buffer ?? null, baseVertex);
      vao = this._vaos.get(key) ?? null;
      if (!vao) {
        vao = gl.createVertexArray();
        if (!vao) throw new UnidrawError("createVertexArray 失败");
        this._vaos.set(key, vao);
        this.setupVao(pipeline, vertexBuffers, index?.buffer ?? null, baseVertex, vao);
      }
      if (simpleCase) {
        cache.vao = vao;
        cache.pipeline = pipeline;
        cache.indexBuffer = index?.buffer ?? null;
        cache.baseVertex = baseVertex;
        cache.vertexSlot0 = vertexBuffers.get(0)?.buffer ?? null;
        cache.vertexOffset0 = vertexBuffers.get(0)?.offset ?? 0;
        cache.vertexCount = vertexBuffers.size;
      } else {
        cache.vao = null;
      }
    }
    if (this._boundVao !== vao) {
      gl.bindVertexArray(vao);
      this._boundVao = vao;
    }
    if (op.k === "draw") {
      gl.drawArraysInstanced(mode, op.firstVertex, op.vertexCount, op.instanceCount);
    } else {
      if (!index) throw new UnidrawError("drawIndexed 需要 setIndexBuffer");
      const byteOffset = index.offset + op.firstIndex * INDEX_FORMAT_BYTES[index.format];
      gl.drawElementsInstanced(mode, op.indexCount, INDEX_TYPES[index.format], byteOffset, op.instanceCount);
    }
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
    this._boundVao = null; // setupVao 结尾解绑，保持状态跟踪一致
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

  /** 多重采样 attachment 用的 renderbuffer（按 格式×尺寸×采样数 缓存复用）。 */
  private getRenderbuffer(texture: GLTexture): WebGLRenderbuffer {
    const gl = this.gl;
    const key = `${texture.format}|${texture.width}x${texture.height}|${texture.sampleCount}`;
    const cached = this._renderbuffers.get(key);
    if (cached) return cached;
    const rb = gl.createRenderbuffer();
    assert(rb, "createRenderbuffer 失败");
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    const params = textureGLParams(gl, texture.format);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, texture.sampleCount, params.internal, texture.width, texture.height);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    this._renderbuffers.set(key, rb);
    return rb;
  }

  /** MSAA framebuffer：颜色/深度都用多重采样 renderbuffer；解析目标在 pass 结束时 blit。 */
  private getMsaaFramebuffer(color: GLTexture | null, depth: GLTexture | null): WebGLFramebuffer {
    const gl = this.gl;
    const key = `msaa:c${color ? color.id : 0}d${depth ? depth.id : 0}s${color?.sampleCount ?? depth?.sampleCount ?? 1}`;
    const cached = this._fbos.get(key);
    if (cached) return cached;
    const fb = gl.createFramebuffer();
    assert(fb, "createFramebuffer 失败");
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    if (color) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.getRenderbuffer(color));
    if (depth) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.getRenderbuffer(depth));
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    assert(status === gl.FRAMEBUFFER_COMPLETE, `MSAA Framebuffer 不完整：0x${status.toString(16)}`);
    this._fbos.set(key, fb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fb;
  }

  /** 把多重采样附件解析（resolve）到普通纹理。 */
  private resolveMsaa(source: WebGLFramebuffer, target: Texture): void {
    const gl = this.gl;
    const tex = target as GLTexture;
    const dst = this.getFramebuffer(tex, null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst);
    gl.blitFramebuffer(
      0,
      0,
      tex.width,
      tex.height,
      0,
      0,
      tex.width,
      tex.height,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  protected destroyNative(): void {
    for (const vao of this._vaos.values()) this.gl.deleteVertexArray(vao);
    this._vaos.clear();
    for (const fb of this._fbos.values()) this.gl.deleteFramebuffer(fb);
    this._fbos.clear();
    for (const rb of this._renderbuffers.values()) this.gl.deleteRenderbuffer(rb);
    this._renderbuffers.clear();
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
