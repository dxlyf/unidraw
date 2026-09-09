/**
 * WebGL2 后端：把统一命令流翻译到同步 WebGL2 API。
 *
 * 关键映射策略：
 * - UBO：所有 uniform 通过 uniform buffer（std140）驱动，避免逐字段 uniform 调用；
 * - bind group：创建 BindGroupLayout 时为每个 entry 分配固定的
 *   UBO binding point / texture unit；绑定资源 = bindBufferBase / bindTexture + bindSampler；
 * - sampler 语义：GLSL 写 `uniform sampler2D u_xxx`（名字 = texture entry 的 name），
 *   后端把该 uniform 指向 layout 分配的纹理单元，并按 entry 出现顺序与 sampler 配对；
 * - VAO：按 (pipeline, 顶点缓冲/索引缓冲快照, baseVertex) 缓存；
 * - canvas 颜色附件 = null view（默认帧缓冲，context 带 depth:true）。
 */

import { Device, type DeviceLimits } from "../../Device.js";
import { BindGroup, BindGroupLayout, Buffer, Program, RenderPipeline, Sampler, Texture, TextureView } from "../../resources.js";
import type {
  BindGroupDescriptor,
  BindGroupLayoutDescriptor,
  BufferDescriptor,
  ProgramDescriptor,
  RenderPipelineDescriptor,
  SamplerDescriptor,
  TextureDescriptor,
  TextureUploadOptions,
} from "../../descriptors.js";
import { assert, UnidrawError } from "../../../util/assert.js";
import type { CommandOp } from "../../../command/ops.js";
import { bindGroupLayoutCacheKey } from "../../descriptors.js";
import type { ColorClearValue } from "../../../gpu/types.js";
import { textureFormatInfo, vertexFormatInfo, INDEX_FORMAT_BYTES } from "../../../gpu/formats.js";
import {
  BufferUsage,
  type BlendFactor,
  type BlendOperation,
  type CompareFunction,
  type IndexFormat,
  type TextureFormat,
} from "../../../gpu/types.js";

type GL = WebGL2RenderingContext;

// ---------------------------------------------------------------------------
// 常量表
// ---------------------------------------------------------------------------

const GL_CONST = {
  DEPTH_TEST: 0x0b71,
  CULL_FACE: 0x0b44,
  BLEND: 0x0be2,
  SCISSOR_TEST: 0x0c11,
  CCW: 0x0901,
  CW: 0x0900,
  FRONT: 0x0404,
  BACK: 0x0405,
  POINTS: 0x0000,
  LINES: 0x0001,
  LINE_STRIP: 0x0003,
  TRIANGLES: 0x0004,
  TRIANGLE_STRIP: 0x0005,
  FUNC_ADD: 0x8006,
  FUNC_SUBTRACT: 0x800a,
  FUNC_REVERSE_SUBTRACT: 0x800b,
  MIN: 0x8007,
  MAX: 0x8008,
  ZERO: 0,
  ONE: 1,
  SRC_COLOR: 0x0302,
  ONE_MINUS_SRC_COLOR: 0x0303,
  SRC_ALPHA: 0x0302,
  ONE_MINUS_SRC_ALPHA: 0x0303,
  DST_COLOR: 0x0306,
  ONE_MINUS_DST_COLOR: 0x0307,
  DST_ALPHA: 0x0306,
  ONE_MINUS_DST_ALPHA: 0x0307,
  SRC_ALPHA_SATURATE: 0x0308,
  CONSTANT_COLOR: 0x8001,
  ONE_MINUS_CONSTANT_COLOR: 0x8002,
} as const;

const BLEND_FACTORS: Record<BlendFactor, number> = {
  zero: GL_CONST.ZERO,
  one: GL_CONST.ONE,
  src: GL_CONST.SRC_COLOR,
  "one-minus-src": GL_CONST.ONE_MINUS_SRC_COLOR,
  "src-alpha": GL_CONST.SRC_ALPHA,
  "one-minus-src-alpha": GL_CONST.ONE_MINUS_SRC_ALPHA,
  dst: GL_CONST.DST_COLOR,
  "one-minus-dst": GL_CONST.ONE_MINUS_DST_COLOR,
  "dst-alpha": GL_CONST.DST_ALPHA,
  "one-minus-dst-alpha": GL_CONST.ONE_MINUS_DST_ALPHA,
  "src-alpha-saturated": GL_CONST.SRC_ALPHA_SATURATE,
  constant: GL_CONST.CONSTANT_COLOR,
  "one-minus-constant": GL_CONST.ONE_MINUS_CONSTANT_COLOR,
};

const BLEND_OPS: Record<BlendOperation, number> = {
  add: GL_CONST.FUNC_ADD,
  subtract: GL_CONST.FUNC_SUBTRACT,
  "reverse-subtract": GL_CONST.FUNC_REVERSE_SUBTRACT,
  min: GL_CONST.MIN,
  max: GL_CONST.MAX,
};

const COMPARE: Record<CompareFunction, number> = {
  never: 0x0200,
  less: 0x0201,
  equal: 0x0202,
  "less-equal": 0x0203,
  greater: 0x0204,
  "not-equal": 0x0205,
  "greater-equal": 0x0206,
  always: 0x0207,
};

const INDEX_TYPES: Record<IndexFormat, number> = {
  uint16: 0x1403,
  uint32: 0x1405,
};

const TOPOLOGY_GL: Record<string, number> = {
  "point-list": GL_CONST.POINTS,
  "line-list": GL_CONST.LINES,
  "line-strip": GL_CONST.LINE_STRIP,
  "triangle-list": GL_CONST.TRIANGLES,
  "triangle-strip": GL_CONST.TRIANGLE_STRIP,
};

let nextResourceId = 1;
function nextId(): number {
  return nextResourceId++;
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function compileShader(gl: GL, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  assert(shader, "无法创建 shader（上下文可能已丢失）");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new UnidrawError(`GLSL 编译失败：\n${log}`);
  }
  return shader;
}

function bufferTarget(usage: number): number {
  if (usage & BufferUsage.INDEX) return 0x8893; // ELEMENT_ARRAY_BUFFER
  if (usage & BufferUsage.UNIFORM) return 0x8a11; // UNIFORM_BUFFER
  if (usage & BufferUsage.STORAGE) return 0x90d2; // SHADER_STORAGE_BUFFER
  return 0x8892; // ARRAY_BUFFER
}

function bufferUsageHint(usage: number): number {
  const dynamic = BufferUsage.UNIFORM | BufferUsage.STORAGE | BufferUsage.COPY_DST;
  return usage & dynamic ? 0x88e8 : 0x88e4; // DYNAMIC_DRAW / STATIC_DRAW
}

/** 纹理格式 → GL 常量（有类型的安全映射） */
function textureGLParams(gl: GL, format: TextureFormat): { internal: number; format: number; type: number } {
  switch (format) {
    case "r8unorm":
      return { internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE };
    case "rg8unorm":
      return { internal: gl.RG8, format: gl.RG, type: gl.UNSIGNED_BYTE };
    case "rgba8unorm":
      return { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    case "rgba8unorm-srgb":
      return { internal: gl.SRGB8_ALPHA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    case "r32float":
      return { internal: gl.R32F, format: gl.RED, type: gl.FLOAT };
    case "rgba16float":
      return { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
    case "rgba32float":
      return { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT };
    case "depth32float":
      return { internal: gl.DEPTH_COMPONENT32F, format: gl.DEPTH_COMPONENT, type: gl.FLOAT };
    case "depth24plus":
      return { internal: gl.DEPTH_COMPONENT24, format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_INT };
    default:
      throw new UnidrawError(`[unidraw] WebGL2 不支持的纹理格式：${format}`);
  }
}

function attributeGLType(gl: GL, glType: "FLOAT" | "UNSIGNED_BYTE" | "BYTE" | "UNSIGNED_SHORT" | "SHORT"): number {
  switch (glType) {
    case "FLOAT":
      return gl.FLOAT;
    case "UNSIGNED_BYTE":
      return gl.UNSIGNED_BYTE;
    case "BYTE":
      return gl.BYTE;
    case "UNSIGNED_SHORT":
      return gl.UNSIGNED_SHORT;
    case "SHORT":
      return gl.SHORT;
  }
}

// ---------------------------------------------------------------------------
// WebGL2 资源
// ---------------------------------------------------------------------------

class GLBuffer extends Buffer {
  readonly glBuffer: WebGLBuffer;
  readonly gl: GL;
  readonly id: number = nextId();
  private readonly _target: number;

  constructor(device: WebGL2Device, desc: BufferDescriptor) {
    super(desc);
    assert(desc.size >= 0, "Buffer size 不能为负");
    this.gl = device.gl;
    this._target = bufferTarget(desc.usage);
    const buf = this.gl.createBuffer();
    assert(buf, "createBuffer 失败");
    this.glBuffer = buf;
    this.gl.bindBuffer(this._target, buf);
    this.gl.bufferData(this._target, desc.size, bufferUsageHint(desc.usage));
    device.register(this);
  }

  override write(data: ArrayBufferView | ArrayBuffer, offset = 0): void {
    assert(offset >= 0, "write offset 不能为负");
    this.gl.bindBuffer(this._target, this.glBuffer);
    this.gl.bufferSubData(this._target, offset, data);
  }

  protected destroyNative(): void {
    this.gl.deleteBuffer(this.glBuffer);
  }
}

class GLTexture extends Texture {
  readonly glTexture: WebGLTexture;
  readonly gl: GL;
  readonly id: number = nextId();

  constructor(device: WebGL2Device, desc: TextureDescriptor) {
    super(desc);
    assert(desc.width >= 1 && desc.height >= 1, "纹理尺寸必须 >=1");
    this.gl = device.gl;
    const tex = this.gl.createTexture();
    assert(tex, "createTexture 失败");
    this.glTexture = tex;
    this.bindScratch();
    const params = textureGLParams(this.gl, desc.format);
    if (GLTexture.isDepthFormatLocal(desc.format)) {
      this.gl.texStorage2D(this.gl.TEXTURE_2D, 1, params.internal, desc.width, desc.height);
    } else {
      this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
      this.gl.texImage2D(this.gl.TEXTURE_2D, 0, params.internal, desc.width, desc.height, 0, params.format, params.type, null);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    }
    device.register(this);
  }

  private static isDepthFormatLocal(format: TextureFormat): boolean {
    return format === "depth32float" || format === "depth24plus";
  }

  /** 内部绑定用纹理单元 0（layout 分配从 1 开始，永不冲突）。 */
  private bindScratch(): void {
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.glTexture);
  }

  protected override createDefaultView(): TextureView {
    return new GLTextureView(this);
  }

  override upload(data: ArrayBufferView, options: TextureUploadOptions = {}): void {
    assert(!GLTexture.isDepthFormatLocal(this.format), "深度纹理不支持 upload");
    const info = textureFormatInfo(this.format);
    const params = textureGLParams(this.gl, this.format);
    const x = options.x ?? 0;
    const y = options.y ?? 0;
    const width = options.width ?? this.width;
    const height = options.height ?? this.height;
    const bytesPerRow = options.bytesPerRow ?? width * info.bytesPerTexel;
    const bpp = info.bytesPerTexel;
    assert(width >= 1 && height >= 1 && x >= 0 && y >= 0, "upload 区域非法");
    assert(x + width <= this.width && y + height <= this.height, "upload 区域越界");
    assert(bytesPerRow % bpp === 0, "bytesPerRow 必须是纹素大小整数倍");
    const rowLength = bytesPerRow / bpp;

    this.bindScratch();
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    this.gl.pixelStorei(this.gl.UNPACK_ROW_LENGTH, rowLength);
    this.gl.pixelStorei(this.gl.UNPACK_SKIP_PIXELS, 0);
    this.gl.texSubImage2D(this.gl.TEXTURE_2D, options.mipLevel ?? 0, x, y, width, height, params.format, params.type, data);
    this.gl.pixelStorei(this.gl.UNPACK_ROW_LENGTH, 0);
  }

  override generateMipmaps(): void {
    this.bindScratch();
    this.gl.generateMipmap(this.gl.TEXTURE_2D);
  }

  protected destroyNative(): void {
    this.gl.deleteTexture(this.glTexture);
  }
}

class GLTextureView extends TextureView {
  constructor(texture: Texture) {
    super(texture);
  }
}

class GLSampler extends Sampler {
  readonly glSampler: WebGLSampler;
  readonly gl: GL;
  readonly id: number = nextId();

  constructor(device: WebGL2Device, desc: SamplerDescriptor) {
    super(desc);
    this.gl = device.gl;
    const s = this.gl.createSampler();
    assert(s, "createSampler 失败");
    this.glSampler = s;
    const d = this.descriptor;
    this.gl.samplerParameteri(s, this.gl.TEXTURE_MIN_FILTER, this.minFilterGL(d.minFilter ?? "linear", d.mipmapFilter ?? "linear", d.mips ?? false));
    this.gl.samplerParameteri(s, this.gl.TEXTURE_MAG_FILTER, (d.magFilter ?? "linear") === "nearest" ? this.gl.NEAREST : this.gl.LINEAR);
    this.gl.samplerParameteri(s, this.gl.TEXTURE_WRAP_S, this.wrapGL(d.addressModeU ?? "clamp-to-edge"));
    this.gl.samplerParameteri(s, this.gl.TEXTURE_WRAP_T, this.wrapGL(d.addressModeV ?? "clamp-to-edge"));
    this.gl.samplerParameteri(s, this.gl.TEXTURE_WRAP_R, this.wrapGL(d.addressModeW ?? "clamp-to-edge"));
    device.register(this);
  }

  /**
   * 仅当显式要求 mips 时才使用 mip 变体过滤；
   * 否则用非 mip 的 NEAREST/LINEAR，保证只有 base level 的纹理是“完整”的。
   */
  private minFilterGL(min: "nearest" | "linear", mip: "nearest" | "linear", mips: boolean): number {
    if (!mips) return min === "nearest" ? this.gl.NEAREST : this.gl.LINEAR;
    if (min === "nearest") return mip === "nearest" ? this.gl.NEAREST_MIPMAP_NEAREST : this.gl.NEAREST_MIPMAP_LINEAR;
    return mip === "nearest" ? this.gl.LINEAR_MIPMAP_NEAREST : this.gl.LINEAR_MIPMAP_LINEAR;
  }

  private wrapGL(mode: "clamp-to-edge" | "repeat" | "mirror-repeat"): number {
    if (mode === "repeat") return this.gl.REPEAT;
    if (mode === "mirror-repeat") return this.gl.MIRRORED_REPEAT;
    return this.gl.CLAMP_TO_EDGE;
  }

  protected destroyNative(): void {
    this.gl.deleteSampler(this.glSampler);
  }
}

class GLProgram extends Program {
  readonly gl: GL;
  private _program: WebGLProgram | null = null;
  private readonly _locations = new Map<string, WebGLUniformLocation | null>();
  private readonly _blockIndex = new Map<string, number>();

  constructor(device: WebGL2Device, desc: ProgramDescriptor) {
    super(desc);
    this.gl = device.gl;
    device.register(this);
  }

  /** 延迟链接，链接后缓存 uniform/UBO 信息。 */
  linkedProgram(): WebGLProgram {
    if (this._program) return this._program;
    assert(this.supportsWebGL2, `program("${this.label}") 缺少 glsl 源码，无法在 WebGL2 后端使用`);
    const gl = this.gl;
    const src = this.descriptor.glsl!;
    const vs = compileShader(gl, gl.VERTEX_SHADER, src.vertex);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, src.fragment);
    const prog = gl.createProgram();
    assert(prog, "createProgram 失败");
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new UnidrawError(`GLSL 链接失败：\n${log}`);
    }
    this._program = prog;

    const uniforms = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < uniforms; i++) {
      const info = gl.getActiveUniform(prog, i);
      if (!info) continue;
      this._locations.set(info.name, gl.getUniformLocation(prog, info.name));
    }
    const blocks = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORM_BLOCKS) as number;
    for (let i = 0; i < blocks; i++) {
      const name = gl.getActiveUniformBlockName(prog, i);
      if (name) this._blockIndex.set(name, i);
    }
    return prog;
  }

  uniformLocation(name: string): WebGLUniformLocation | null {
    if (this._locations.has(name)) return this._locations.get(name) ?? null;
    const prog = this._program;
    if (!prog) return null;
    const loc = this.gl.getUniformLocation(prog, name);
    this._locations.set(name, loc);
    return loc;
  }

  bindUniformBlock(name: string, point: number): void {
    const idx = this._blockIndex.get(name);
    if (idx === undefined || !this._program) return;
    this.gl.uniformBlockBinding(this._program, idx, point);
  }

  protected destroyNative(): void {
    if (this._program) this.gl.deleteProgram(this._program);
    this._program = null;
  }
}

class GLBindGroupLayout extends BindGroupLayout {
  /** uniform-buffer entry 的 binding point（数组与 layout 中 UBO entry 顺序对齐） */
  readonly uboPoints: number[];
  /** texture entry 的纹理单元（与 texture entry 顺序对齐） */
  readonly textureUnits: number[];
  private readonly _device: WebGL2Device;

  constructor(device: WebGL2Device, desc: BindGroupLayoutDescriptor) {
    super(desc);
    this._device = device;
    const ubo: number[] = [];
    const units: number[] = [];
    for (const entry of desc.entries) {
      if (entry.type === "uniform-buffer") ubo.push(device.allocateUniformBinding());
      else if (entry.type === "texture") units.push(device.allocateTextureUnit());
    }
    this.uboPoints = ubo;
    this.textureUnits = units;
    device.register(this);
  }

  protected destroyNative(): void {
    // 归还 binding point / 纹理单元，并让其失效的缓存项可被重新分配
    for (const point of this.uboPoints) this._device.freeUniformBinding(point);
    for (const unit of this.textureUnits) this._device.freeTextureUnit(unit);
    this._device.dropLayoutCache(this);
  }
}

class GLBindGroup extends BindGroup {
  constructor(device: WebGL2Device, desc: BindGroupDescriptor) {
    super(desc);
    const byBinding = new Map(desc.layout.entries.map((e) => [e.binding, e]));
    for (const entry of desc.entries) {
      const def = byBinding.get(entry.binding);
      assert(def, `bind group binding ${entry.binding} 未在布局中声明`);
      if (def.type === "uniform-buffer") assert(entry.resource instanceof Buffer, `binding ${entry.binding} 需要 Buffer`);
      else if (def.type === "sampler") assert(entry.resource instanceof Sampler, `binding ${entry.binding} 需要 Sampler`);
      else assert(entry.resource instanceof TextureView, `binding ${entry.binding} 需要 TextureView`);
    }
    device.register(this);
  }

  protected destroyNative(): void {}
}

class GLRenderPipeline extends RenderPipeline {
  readonly glProgram: GLProgram;
  readonly id: number = nextId();

  constructor(device: WebGL2Device, desc: RenderPipelineDescriptor) {
    super(desc);
    this.glProgram = desc.program as GLProgram;
    this.glProgram.linkedProgram();
    // 把每个 UBO block 绑定到其 layout 分配的 binding point
    for (const layout of desc.bindGroupLayouts) {
      const glLayout = layout as GLBindGroupLayout;
      let uboIdx = 0;
      for (const entry of layout.entries) {
        if (entry.type !== "uniform-buffer") continue;
        if (entry.name) this.glProgram.bindUniformBlock(entry.name, glLayout.uboPoints[uboIdx]!);
        uboIdx++;
      }
    }
    device.register(this);
  }

  protected destroyNative(): void {}
}

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
        case "setViewport":
          gl.viewport(op.x, op.y, op.width, op.height);
          break;
        case "setScissorRect":
          gl.enable(gl.SCISSOR_TEST);
          this._scissorEnabled = true;
          gl.scissor(op.x, op.y, op.width, op.height);
          break;
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

function describeRenderer(gl: GL): string {
  try {
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = info ? (gl.getParameter(info.UNMASKED_RENDERER_WEBGL) as string) : String(gl.getParameter(gl.RENDERER));
    return renderer || "unknown GPU";
  } catch {
    return "unknown GPU";
  }
}
