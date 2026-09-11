import type { Device } from "../device/Device.js";
import type { RenderPassEncoder } from "../command/encoder.js";
import type { Texture } from "../device/resources.js";
import type { BindGroup, BindGroupLayout, Buffer, Program, RenderPipeline, Sampler } from "../device/resources.js";
import { ColorWriteMask } from "../device/descriptors.js";
import { UniformBlock } from "../render/UniformBlock.js";
import { Mat4 } from "../math/mat4.js";
import { Color } from "../math/color.js";
import { BufferUsage, TextureUsage } from "../gpu/types.js";
import type { PaintStyle } from "./style.js";
import { sampleStyle } from "./style.js";
import { hexColor, type GradientStop } from "./color.js";
import { LinearGradient } from "./LinearGradient.js";
import { RadialGradient } from "./RadialGradient.js";
import { Path2D } from "./path.js";
import { fillTriangles, type FillRule } from "./fill.js";
import type { Contour } from "./pathTypes.js";
import type { Pt2 } from "./matrix.js";
import { identityAffine, copyAffine, multiplyAffine, transformPoint } from "./matrix.js";
import { FLAT_FS_GLSL, FLAT_VS_GLSL, FLAT_WGSL, TEX_FS_GLSL, TEX_VS_GLSL, TEX_WGSL } from "./shaders.js";
import { TextRenderer, type TextMetricsLike } from "./text.js";
import type { Canvas2DOptions, DeviceRect, LineCap, LineJoin, Op, SavedState, TextAlign, TextBaseline } from "./types.js";
import { DEFAULT_FONT } from "./types.js";
import { detectRectContour, intersectRects, lineIntersect, normalOffset, sameClip, unitDir } from "./geometry2d.js";

/** 渐变 LUT 的采样数（512×1：stop 插值由浏览器的 CanvasGradient 完成，与原生一致） */
const GRADIENT_LUT_SIZE = 512;
/** LUT 缓存上限（超出按插入顺序淘汰最旧的） */
const GRADIENT_LUT_CACHE = 64;

/**
 * 一次 `fill()`/`stroke()` 用到的画笔。
 *
 * `kind`：0 = 纯色（走顶点色）、1 = 线性渐变、2 = 径向渐变（都走 LUT 逐像素求值）。
 * `frame` 是**用户空间**的渐变几何：线性为 `(x0,y0,x1,y1)`，径向为 `(cx,cy,r)`。
 */
interface ResolvedPaint {
  kind: number;
  frame: [number, number, number, number, number, number, number];
  lut: Texture | null;
  /** 顶点色（渐变时是 (1,1,1,globalAlpha)，颜色交给 LUT） */
  vcolor: [number, number, number, number];
}

const SOLID_PAINT: ResolvedPaint = { kind: 0, frame: [0, 0, 0, 0, 0, 0, 1], lut: null, vcolor: [1, 1, 1, 1] };

export class Canvas2D {
  private device: Device;
  private textRenderer: TextRenderer;

  // ---- 每帧几何缓冲（动态）与 op 顺序列表 ----
  private flatV: number[] = [];
  private flatI: number[] = [];
  private textV: number[] = [];
  private textI: number[] = [];
  private ops: Op[] = [];

  private flatVBuf: Buffer | null = null;
  private flatIBuf: Buffer | null = null;
  private textVBuf: Buffer | null = null;
  private textIBuf: Buffer | null = null;
  private flatCap = 1 << 13;
  private textCap = 1 << 12;

  private viewBlock!: UniformBlock;
  private flatProgram!: Program;
  private texProgram!: Program;
  private texLayout!: BindGroupLayout;
  /**
   * 管线按**采样数**缓存。
   *
   * WebGPU 要求「管线声明的 `multisample.count` 必须与 render pass 的颜色附件一致」，
   * 而框架现在默认把一帧渲染进 4x MSAA 离屏目标（`RendererOptions.msaa`，默认 4）——
   * 所以 2D 也必须有 4x 版本，否则 WebGPU 直接校验失败、整层 2D 内容静默消失
   * （WebGL2 不校验，所以只在 WebGPU 上暴露）。
   */
  private readonly flatPipelines = new Map<number, RenderPipeline>();
  private readonly texPipelines = new Map<number, RenderPipeline>();
  private sampler!: Sampler;
  private readonly textureGroups = new WeakMap<Texture, BindGroup>();
  private pipelineFormat: string | null = null;
  /** 纯色绘制绑定的 1×1 白 LUT（着色器直接走顶点色，不采样渐变） */
  private solidLut!: Texture;
  /** 渐变 LUT 缓存（key = kind + stops，插入顺序即 LRU 顺序） */
  private readonly gradLuts = new Map<string, Texture>();
  /** 当前 `fill()/stroke()` 使用的画笔 */
  private paint: ResolvedPaint = SOLID_PAINT;

  private viewW = 1;
  private viewH = 1;

  // ---- 状态 ----
  private path = new Path2D();
  private stack: SavedState[] = [];
  private state: SavedState = {
    ctm: identityAffine(),
    fillStyle: "#ffffff",
    strokeStyle: "#ffffff",
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    miterLimit: 10,
    font: DEFAULT_FONT,
    textAlign: "left",
    textBaseline: "alphabetic",
    lineDash: [],
    lineDashOffset: 0,
    clip: null,
  };

  constructor(device: Device, options: Canvas2DOptions = {}) {
    this.device = device;
    if (options.vertexCapacity) {
      this.flatCap = Math.max(2048, options.vertexCapacity);
      this.textCap = Math.max(1024, options.vertexCapacity >> 1);
    }
    this.textRenderer = new TextRenderer(device);
    this.initResources();
  }

  private initResources(): void {
    const d = this.device;
    const canvasFormat = d.canvasFormat() ?? "rgba8unorm";
    this.viewBlock = new UniformBlock(d, { label: "2d-view", fields: [{ name: "u_viewProj", type: "mat4" }] });

    // 两套管线共用同一份布局：UBO(view) + 纹理（渐变 LUT / 字形图集）+ 采样器。
    // 「纯色」也走这条路径，只是绑 1×1 白纹理，由着色器按 kind 分支决定是否采样。
    this.texLayout = d.createBindGroupLayout({
      label: "2d-paint-layout",
      entries: [
        { binding: 0, type: "uniform-buffer", visibility: 1, name: "ViewBlock" },
        { binding: 1, type: "texture", visibility: 2, name: "u_paintTex" },
        { binding: 2, type: "sampler", visibility: 2, name: "u_paintTexSampler" },
      ],
    });
    this.flatProgram = d.createProgram({
      label: "2d-flat",
      glsl: { vertex: FLAT_VS_GLSL, fragment: FLAT_FS_GLSL },
      wgsl: { code: FLAT_WGSL },
    });
    this.texProgram = d.createProgram({
      label: "2d-tex",
      glsl: { vertex: TEX_VS_GLSL, fragment: TEX_FS_GLSL },
      wgsl: { code: TEX_WGSL },
    });
    this.pipelineFormat = canvasFormat;

    this.sampler = d.createSampler({
      label: "2d-tex-sampler",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "nearest",
      mips: false,
    });

    // 纯色用的 1×1 白 LUT
    this.solidLut = d.createTexture({
      label: "2d-solid-lut",
      width: 1,
      height: 1,
      format: "rgba8unorm",
      usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST,
    });
    this.solidLut.upload(new Uint8Array([255, 255, 255, 255]));

    // 平铺先建好 1x/4x 两个常用采样数（4x 是本框架的默认画布采样数）
    this.pipelineFor("flat", 1);
    this.pipelineFor("tex", 1);
    if ((d.limits.maxSamples ?? 1) >= 4) {
      this.pipelineFor("flat", 4);
      this.pipelineFor("tex", 4);
    }
  }

  /** 取（或惰性创建）指定采样数下的管线；格式固定为画布格式（与 MSAA 目标一致） */
  private pipelineFor(kind: "flat" | "tex", sampleCount: number): RenderPipeline {
    const cache = kind === "flat" ? this.flatPipelines : this.texPipelines;
    const count = Math.max(1, Math.floor(sampleCount));
    let pipeline = cache.get(count);
    if (pipeline) return pipeline;
    const format = (this.pipelineFormat ?? this.device.canvasFormat() ?? "rgba8unorm") as Parameters<Device["createTexture"]>[0]["format"];
    const blend = {
      color: { srcFactor: "src-alpha" as const, dstFactor: "one-minus-src-alpha" as const, operation: "add" as const },
      alpha: { srcFactor: "one" as const, dstFactor: "one-minus-src-alpha" as const, operation: "add" as const },
    };
    const target = { format, writeMask: ColorWriteMask.ALL, blend };
    pipeline = this.device.createRenderPipeline({
      label: `2d-${kind}-pipe${count > 1 ? `-msaa${count}` : ""}`,
      program: kind === "flat" ? this.flatProgram : this.texProgram,
      bindGroupLayouts: [this.texLayout],
      vertex: {
        buffers: [
          kind === "flat"
            ? {
                // 见 shaders.ts 的顶点布局说明（渐变按用户空间逐像素求值）
                arrayStride: 64,
                attributes: [
                  { location: 0, format: "float32x2" as const, offset: 0 },
                  { location: 1, format: "float32x4" as const, offset: 8 },
                  { location: 2, format: "float32x2" as const, offset: 24 },
                  { location: 3, format: "float32x4" as const, offset: 32 },
                  { location: 4, format: "float32x4" as const, offset: 48 },
                ],
              }
            : {
                arrayStride: 32,
                attributes: [
                  { location: 0, format: "float32x2" as const, offset: 0 },
                  { location: 1, format: "float32x2" as const, offset: 8 },
                  { location: 2, format: "float32x4" as const, offset: 16 },
                ],
              },
        ],
      },
      primitive: { topology: "triangle-list", cullMode: "none", frontFace: "ccw" },
      multisample: { count },
      targets: [target],
    });
    cache.set(count, pipeline);
    return pipeline;
  }

  /**
   * 渐变 LUT：用浏览器的 `CanvasGradient` 光栅化成 512×1 纹理。
   *
   * 借原生实现生成 LUT 有两个好处：stop 之间的插值空间/取整规则与
   * 原生 Canvas2D **完全一致**，而且 CPU 侧不需要再实现一遍插值。
   * 按 `kind + stops` 缓存（同一渐变每帧重建也只光栅化一次）。
   */
  private gradientLut(kind: "linear" | "radial", stops: readonly GradientStop[]): Texture {
    const key =
      kind +
      "|" +
      stops
        .map((s) => `${s.offset.toFixed(4)}:${Math.round(s.color.r * 255)},${Math.round(s.color.g * 255)},${Math.round(s.color.b * 255)},${s.color.a.toFixed(3)}`)
        .join(";");
    const hit = this.gradLuts.get(key);
    if (hit) return hit;
    const cv = document.createElement("canvas");
    cv.width = GRADIENT_LUT_SIZE;
    cv.height = 1;
    const ctx = cv.getContext("2d");
    if (!ctx) throw new Error("[unidraw] 无法创建 2D 画布用于渐变 LUT");
    const g = ctx.createLinearGradient(0, 0, GRADIENT_LUT_SIZE, 0);
    for (const s of stops) {
      const r = Math.round(Math.max(0, Math.min(1, s.color.r)) * 255);
      const gg = Math.round(Math.max(0, Math.min(1, s.color.g)) * 255);
      const b = Math.round(Math.max(0, Math.min(1, s.color.b)) * 255);
      const a = Math.max(0, Math.min(1, s.color.a));
      g.addColorStop(Math.max(0, Math.min(1, s.offset)), `rgba(${r},${gg},${b},${a})`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, GRADIENT_LUT_SIZE, 1);
    const px = ctx.getImageData(0, 0, GRADIENT_LUT_SIZE, 1).data;
    const tex = this.device.createTexture({
      label: `2d-${kind}-lut`,
      width: GRADIENT_LUT_SIZE,
      height: 1,
      format: "rgba8unorm",
      usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST,
    });
    tex.upload(new Uint8Array(px));
    this.gradLuts.set(key, tex);
    if (this.gradLuts.size > GRADIENT_LUT_CACHE) {
      const oldest = this.gradLuts.keys().next().value as string | undefined;
      if (oldest !== undefined) {
        this.gradLuts.get(oldest)?.destroy();
        this.gradLuts.delete(oldest);
      }
    }
    return tex;
  }

  /** 把当前样式解析成「顶点色 + 渐变几何 + LUT」 */
  private resolvePaint(style: PaintStyle): ResolvedPaint {
    const alpha = this.state.globalAlpha;
    if (style instanceof LinearGradient) {
      return {
        kind: 1,
        frame: [style.x0, style.y0, style.x1, style.y1, 0, 0, 1],
        lut: this.gradientLut("linear", style.stops),
        vcolor: [1, 1, 1, alpha],
      };
    }
    if (style instanceof RadialGradient) {
      return {
        kind: 2,
        frame: [0, 0, 0, 0, style.cx, style.cy, style.r],
        lut: this.gradientLut("radial", style.stops),
        vcolor: [1, 1, 1, alpha],
      };
    }
    const c = typeof style === "string" ? hexColor(style) : (style as Color);
    return { kind: 0, frame: [0, 0, 0, 0, 0, 0, 1], lut: null, vcolor: [c.r, c.g, c.b, c.a * alpha] };
  }

  // ======================================================================
  // 状态访问器
  // ======================================================================

  get fillStyle(): PaintStyle {
    return this.state.fillStyle;
  }
  set fillStyle(v: PaintStyle) {
    this.state.fillStyle = v;
  }
  get strokeStyle(): PaintStyle {
    return this.state.strokeStyle;
  }
  set strokeStyle(v: PaintStyle) {
    this.state.strokeStyle = v;
  }
  get globalAlpha(): number {
    return this.state.globalAlpha;
  }
  set globalAlpha(v: number) {
    this.state.globalAlpha = Math.max(0, Math.min(1, v));
  }
  get lineWidth(): number {
    return this.state.lineWidth;
  }
  set lineWidth(v: number) {
    this.state.lineWidth = Math.max(0.001, v);
  }
  get lineCap(): LineCap {
    return this.state.lineCap;
  }
  set lineCap(v: LineCap) {
    this.state.lineCap = v;
  }
  get lineJoin(): LineJoin {
    return this.state.lineJoin;
  }
  set lineJoin(v: LineJoin) {
    this.state.lineJoin = v;
  }
  get miterLimit(): number {
    return this.state.miterLimit;
  }
  set miterLimit(v: number) {
    this.state.miterLimit = v;
  }
  get font(): string {
    return this.state.font;
  }
  set font(v: string) {
    this.state.font = v;
  }
  get textAlign(): TextAlign {
    return this.state.textAlign;
  }
  set textAlign(v: TextAlign) {
    this.state.textAlign = v === "center" || v === "right" || v === "end" ? v : "left";
  }
  get textBaseline(): TextBaseline {
    return this.state.textBaseline;
  }
  set textBaseline(v: TextBaseline) {
    this.state.textBaseline =
      v === "top" || v === "middle" || v === "bottom" || v === "hanging" || v === "ideographic" ? v : "alphabetic";
  }
  /** 虚线样式：空数组 = 实线（与原生 `setLineDash` 语义一致） */
  setLineDash(segments: readonly number[]): void {
    const clean: number[] = [];
    for (const s of segments) {
      if (Number.isFinite(s) && s >= 0) clean.push(s);
    }
    if (clean.length === 0 || clean.every((v) => v === 0)) {
      this.state.lineDash = [];
      return;
    }
    // 奇数个元素要复制一遍（原生规则：`[5]` 等价于 `[5,5]`）
    this.state.lineDash = clean.length % 2 === 1 ? [...clean, ...clean] : clean;
  }
  getLineDash(): number[] {
    return [...this.state.lineDash];
  }
  get lineDashOffset(): number {
    return this.state.lineDashOffset;
  }
  set lineDashOffset(v: number) {
    this.state.lineDashOffset = Number.isFinite(v) ? v : 0;
  }

  save(): void {
    this.stack.push({
      ctm: copyAffine(this.state.ctm),
      fillStyle: this.state.fillStyle,
      strokeStyle: this.state.strokeStyle,
      globalAlpha: this.state.globalAlpha,
      lineWidth: this.state.lineWidth,
      lineCap: this.state.lineCap,
      lineJoin: this.state.lineJoin,
      miterLimit: this.state.miterLimit,
      font: this.state.font,
      textAlign: this.state.textAlign,
      textBaseline: this.state.textBaseline,
      lineDash: [...this.state.lineDash],
      lineDashOffset: this.state.lineDashOffset,
      clip: this.state.clip ? { ...this.state.clip } : null,
    });
  }

  restore(): void {
    const s = this.stack.pop();
    if (!s) throw new Error("[unidraw] Canvas2D.restore() 与 save() 不匹配");
    this.state = { ...s };
  }

  translate(tx: number, ty: number): this {
    multiplyAffine(this.state.ctm, { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }, this.state.ctm);
    return this;
  }
  scale(sx: number, sy = sx): this {
    multiplyAffine(this.state.ctm, { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }, this.state.ctm);
    return this;
  }
  rotate(rad: number): this {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    multiplyAffine(this.state.ctm, { a: c, b: s, c: -s, d: c, e: 0, f: 0 }, this.state.ctm);
    return this;
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): this {
    this.state.ctm = { a, b, c, d, e, f };
    return this;
  }
  resetTransform(): this {
    this.state.ctm = identityAffine();
    return this;
  }

  // ======================================================================
  // 路径委托
  // ======================================================================

  beginPath(): this {
    this.path.begin();
    return this;
  }
  moveTo(x: number, y: number): this {
    this.path.moveTo(x, y);
    return this;
  }
  lineTo(x: number, y: number): this {
    this.path.lineTo(x, y);
    return this;
  }
  quadraticCurveTo(x1: number, y1: number, x: number, y: number): this {
    this.path.quadraticCurveTo(x1, y1, x, y);
    return this;
  }
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    this.path.bezierCurveTo(x1, y1, x2, y2, x, y);
    return this;
  }
  arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw = false): this {
    this.path.arc(cx, cy, r, a0, a1, ccw);
    return this;
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): this {
    this.path.arcTo(x1, y1, x2, y2, r);
    return this;
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false): this {
    this.path.ellipse(cx, cy, rx, ry, rot, a0, a1, ccw);
    return this;
  }
  rect(x: number, y: number, w: number, h: number): this {
    this.path.rect(x, y, w, h);
    return this;
  }
  roundRect(x: number, y: number, w: number, h: number, r: number | [number, number, number, number]): this {
    this.path.roundRect(x, y, w, h, r);
    return this;
  }
  closePath(): this {
    this.path.closePath();
    return this;
  }

  // ======================================================================
  // 帧
  // ======================================================================

  begin(): this {
    this.flatV.length = 0;
    this.flatI.length = 0;
    this.textV.length = 0;
    this.textI.length = 0;
    this.ops.length = 0;
    this.stack.length = 0;
    // 裁剪是“每帧重新建立”的状态：避免上一帧异常/未 restore 时把后续整帧都裁掉
    this.state.clip = null;
    this.path.begin();
    return this;
  }

  setViewportSize(width: number, height: number): this {
    this.viewW = Math.max(1, width);
    this.viewH = Math.max(1, height);
    return this;
  }

  /** 提交本帧：先按 op 顺序补裁剪，再以索引子范围 draw */
  flush(pass: RenderPassEncoder, viewProj: Mat4): void {
    if (this.ops.length === 0) return;
    this.viewBlock.setMat4("u_viewProj", viewProj);
    this.viewBlock.flush();

    this.ensureCapacity();
    if (this.flatV.length > 0) {
      this.flatVBuf!.write(new Float32Array(this.flatV));
      this.flatIBuf!.write(new Uint16Array(this.flatI));
    }
    if (this.textV.length > 0) {
      this.textVBuf!.write(new Float32Array(this.textV));
      this.textIBuf!.write(new Uint16Array(this.textI));
    }

    let lastKind: "flat" | "text" | null = null;
    let lastClip: DeviceRect | null = null;
    let clipInit = false;
    /** 当前绑定在 binding 1 的纹理（渐变 LUT / 字形图集） */
    let lastTex: Texture | null = null;
    // 管线必须与 pass 的采样数匹配（WebGPU 校验；WebGL2 不校验但同样要走对分支）
    const flatPipeline = this.pipelineFor("flat", pass.sampleCount);
    const texPipeline = this.pipelineFor("tex", pass.sampleCount);

    for (const op of this.ops) {
      const c = op.clip;
      if (!clipInit || !sameClip(lastClip, c)) {
        if (c) pass.setScissorRect(c.x, c.y, c.w, c.h);
        else pass.setScissorRect(0, 0, this.viewW, this.viewH);
        lastClip = c;
        clipInit = true;
      }
      if (lastKind !== op.kind) {
        lastKind = op.kind;
        if (op.kind === "flat") {
          pass.setPipeline(flatPipeline);
          if (this.flatVBuf && this.flatIBuf) {
            pass.setVertexBuffer(0, this.flatVBuf);
            pass.setIndexBuffer(this.flatIBuf, "uint16");
          }
        } else {
          pass.setPipeline(texPipeline);
          if (this.textVBuf && this.textIBuf) {
            pass.setVertexBuffer(0, this.textVBuf);
            pass.setIndexBuffer(this.textIBuf, "uint16");
          }
        }
      }
      // 纹理绑定逐 op 变化（每个渐变一张 LUT、每个字符串一张字形图集）
      const wantTex = (op.kind === "flat" ? (op.lut ?? this.solidLut) : op.texture) as Texture;
      if (lastTex !== wantTex) {
        pass.setBindGroup(0, this.textureGroup(wantTex));
        lastTex = wantTex;
      }
      const n = op.iEnd - op.iStart;
      if (n > 0) pass.drawIndexed(n, 1, op.iStart, 0, 0);
    }
  }

  private ensureCapacity(): void {
    const flatVertCount = this.flatV.length / 16;
    if (flatVertCount > this.flatCap) {
      while (this.flatCap < flatVertCount) this.flatCap *= 2;
      this.freeBuffers("flat");
    }
    const textVertCount = this.textV.length / 8;
    if (textVertCount > this.textCap) {
      while (this.textCap < textVertCount) this.textCap *= 2;
      this.freeBuffers("text");
    }
    if (!this.flatVBuf && flatVertCount > 0) {
      this.flatVBuf = this.device.createBuffer({ size: this.flatCap * 64, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
      this.flatIBuf = this.device.createBuffer({ size: this.flatCap * 3 * 2, usage: BufferUsage.INDEX | BufferUsage.COPY_DST });
    }
    if (!this.textVBuf && textVertCount > 0) {
      this.textVBuf = this.device.createBuffer({ size: this.textCap * 32, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
      this.textIBuf = this.device.createBuffer({ size: this.textCap * 3 * 2, usage: BufferUsage.INDEX | BufferUsage.COPY_DST });
    }
  }

  private freeBuffers(kind: "flat" | "text"): void {
    if (kind === "flat") {
      this.flatVBuf?.destroy();
      this.flatIBuf?.destroy();
      this.flatVBuf = null;
      this.flatIBuf = null;
    } else {
      this.textVBuf?.destroy();
      this.textIBuf?.destroy();
      this.textVBuf = null;
      this.textIBuf = null;
    }
  }

  /** 按纹理缓存 bind group（渐变 LUT 与字形图集共用同一份布局） */
  private textureGroup(texture: Texture): BindGroup {
    let g = this.textureGroups.get(texture);
    if (!g) {
      g = this.device.createBindGroup({
        layout: this.texLayout,
        entries: [
          { binding: 0, resource: this.viewBlock.buffer },
          { binding: 1, resource: texture.view() },
          { binding: 2, resource: this.sampler },
        ],
      });
      this.textureGroups.set(texture, g);
    }
    return g;
  }

  // ======================================================================
  // 顶点发射
  // ======================================================================

  private devPt(x: number, y: number): { x: number; y: number } {
    return transformPoint(this.state.ctm, x, y, { x: 0, y: 0 });
  }

  // ======================================================================
  // 虚线
  // ======================================================================

  /**
   * 按 `lineDash` / `lineDashOffset` 把轮廓切成实线段。
   *
   * 与原生一致：按**弧长**在压平后的折线上推进，奇数长度的模式复制一遍
   * （`[5]` ≡ `[5,5]`），`lineDashOffset` 表示从模式内的哪个距离开始；
   * 闭合轮廓会跨越起点继续（首段与末段共用同一个相位）。
   */
  private applyLineDash(contours: Contour[]): Contour[] {
    const dash = this.state.lineDash;
    if (dash.length === 0) return contours;
    const period = dash.reduce((a, b) => a + b, 0);
    if (!(period > 1e-9)) return contours;

    // 起始相位
    let phase = ((this.state.lineDashOffset % period) + period) % period;
    let index = 0;
    while (phase >= dash[index]! - 1e-9 && dash[index]! > 0) {
      phase -= dash[index]!;
      index = (index + 1) % dash.length;
    }

    const out: Contour[] = [];
    for (const contour of contours) {
      const pts = contour.points;
      if (pts.length < 2) continue;
      let idx = index;
      let remaining = dash[idx]! - phase;
      let on = idx % 2 === 0;
      let cur: Pt2[] | null = null;
      const flush = (): void => {
        if (cur && cur.length >= 2) out.push({ points: cur, closed: false });
        cur = null;
      };
      const segCount = contour.closed ? pts.length : pts.length - 1;
      for (let s = 0; s < segCount; s++) {
        const a = pts[s]!;
        const b = pts[(s + 1) % pts.length]!;
        const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (segLen < 1e-9) continue;
        let consumed = 0;
        while (segLen - consumed > 1e-9) {
          const step = Math.min(remaining, segLen - consumed);
          const t0 = consumed / segLen;
          const t1 = (consumed + step) / segLen;
          const p0: Pt2 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
          const p1: Pt2 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
          if (on) {
            if (!cur) cur = [p0];
            cur.push(p1);
          } else {
            flush();
          }
          consumed += step;
          remaining -= step;
          if (remaining <= 1e-9) {
            idx = (idx + 1) % dash.length;
            remaining = dash[idx]!;
            on = !on;
          }
        }
      }
      flush();
    }
    return out;
  }

  /**
   * 发射一个「平铺」顶点（纯色或渐变，stride 64，见 shaders.ts）。
   *
   * 渐变不在顶点上采样颜色，只把**用户空间坐标**和渐变几何带下去，
   * 由片元着色器逐像素求 t 再查 LUT —— 这是与原生 Canvas2D 对齐的关键。
   */
  private pushFlat(ux: number, uy: number): number {
    const paint = this.paint;
    const p = this.devPt(ux, uy);
    const v = this.flatV.length / 16;
    const c = paint.vcolor;
    const f = paint.frame;
    this.flatV.push(
      p.x, p.y,
      c[0], c[1], c[2], c[3],
      ux, uy,
      paint.kind, f[0], f[1], f[2],
      f[3], f[4], f[5], f[6],
    );
    return v;
  }

  private pushTextV(ux: number, uy: number, u: number, v: number, style: PaintStyle): number {
    const c = sampleStyle(style, ux, uy);
    const p = this.devPt(ux, uy);
    const id = this.textV.length / 8;
    this.textV.push(p.x, p.y, u, v, c.r, c.g, c.b, c.a * this.state.globalAlpha);
    return id;
  }

  private pushTri(arr: "flat" | "text", a: number, b: number, c: number): void {
    (arr === "flat" ? this.flatI : this.textI).push(a, b, c);
  }

  private recordFlat(iStart: number): void {
    if (this.flatI.length > iStart) {
      this.ops.push({
        kind: "flat",
        clip: this.state.clip ? { ...this.state.clip } : null,
        iStart,
        iEnd: this.flatI.length,
        lut: this.paint.lut,
      });
    }
  }

  // ======================================================================
  // 填充
  // ======================================================================

  /**
   * 填充当前路径。
   *
   * @param rule 填充规则（默认 `"nonzero"`，与原生一致）：多子路径按规则求**精确**
   *   填充区域 —— 内环挖洞、重叠子路径只覆盖一次（半透明不会出现深色缝）、
   *   自相交路径也正确。
   */
  fill(rule: FillRule = "nonzero"): void {
    const contours = this.path.flatten(0.2);
    if (contours.length === 0) return;
    const polys: Pt2[][] = [];
    for (const contour of contours) {
      if (contour.points.length >= 3) polys.push(contour.points);
    }
    if (polys.length === 0) return;
    this.paint = this.resolvePaint(this.state.fillStyle);
    const iStart = this.flatI.length;
    for (const tri of fillTriangles(polys, rule)) {
      const ids: number[] = [this.pushFlat(tri[0]![0], tri[0]![1]), this.pushFlat(tri[1]![0], tri[1]![1]), this.pushFlat(tri[2]![0], tri[2]![1])];
      this.pushTri("flat", ids[0]!, ids[1]!, ids[2]!);
    }
    this.recordFlat(iStart);
  }

  // 便捷绘制
  fillRect(x: number, y: number, w: number, h: number): this {
    this.beginPath();
    this.rect(x, y, w, h);
    this.fill();
    return this;
  }
  strokeRect(x: number, y: number, w: number, h: number): this {
    this.beginPath();
    this.rect(x, y, w, h);
    this.stroke();
    return this;
  }
  fillCircle(cx: number, cy: number, r: number): this {
    this.beginPath();
    this.arc(cx, cy, r, 0, Math.PI * 2);
    this.fill();
    return this;
  }
  strokeCircle(cx: number, cy: number, r: number): this {
    this.beginPath();
    this.arc(cx, cy, r, 0, Math.PI * 2);
    this.stroke();
    return this;
  }

  // ======================================================================
  // 描边
  // ======================================================================

  stroke(): void {
    const contours = this.applyLineDash(this.path.flatten(0.2));
    if (contours.length === 0) return;
    this.paint = this.resolvePaint(this.state.strokeStyle);
    const hw = this.state.lineWidth / 2;
    const iStart = this.flatI.length;

    const quadRaw = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) => {
      const p = (x: number, y: number) => this.pushFlat(x, y);
      const v0 = p(ax, ay);
      const v1 = p(bx, by);
      const v2 = p(cx, cy);
      const v3 = p(dx, dy);
      this.pushTri("flat", v0, v1, v2);
      this.pushTri("flat", v0, v2, v3);
    };

    // 单段矩形
    const segmentQuad = (ax: number, ay: number, bx: number, by: number, nx: number, ny: number) => {
      quadRaw(ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny);
    };

    const fan = (cx: number, cy: number, a0: number, a1: number) => {
      const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) / (Math.PI * 2)) * 64));
      const vc = this.pushFlat(cx, cy);
      let prev = -1;
      for (let i = 0; i <= n; i++) {
        const t = a0 + ((a1 - a0) * i) / n;
        const v = this.pushFlat(cx + Math.cos(t) * hw, cy + Math.sin(t) * hw);
        if (prev >= 0) this.pushTri("flat", vc, prev, v);
        prev = v;
      }
    };

    const cap = (px: number, py: number, dirx: number, diry: number, nxx: number, nyy: number) => {
      const capKind = this.state.lineCap;
      if (capKind === "butt") return;
      if (capKind === "square") {
        quadRaw(px + nxx, py + nyy, px + nxx + dirx * hw, py + nyy + diry * hw, px - nxx + dirx * hw, py - nyy + diry * hw, px - nxx, py - nyy);
        return;
      }
      // round：以端点为中心的半圆，朝向 dir
      const aDir = Math.atan2(diry, dirx);
      fan(px, py, aDir - Math.PI / 2, aDir + Math.PI / 2);
    };

    for (const contour of contours) {
      const pts = contour.points;
      const n = pts.length;
      if (n < 2) continue;
      if (contour.closed) {
        // 每段矩形
        for (let i = 0; i < n; i++) {
          const p = pts[i]!;
          const q = pts[(i + 1) % n]!;
          const off = normalOffset(p[0], p[1], q[0], q[1], hw);
          segmentQuad(p[0], p[1], q[0], q[1], off.x, off.y);
        }
        // 连接处
        for (let i = 0; i < n; i++) {
          this.joinCorner(pts[(i - 1 + n) % n]!, pts[i]!, pts[(i + 1) % n]!, hw);
        }
      } else {
        for (let i = 0; i < n - 1; i++) {
          const p = pts[i]!;
          const q = pts[i + 1]!;
          const off = normalOffset(p[0], p[1], q[0], q[1], hw);
          segmentQuad(p[0], p[1], q[0], q[1], off.x, off.y);
        }
        for (let i = 1; i < n - 1; i++) {
          this.joinCorner(pts[i - 1]!, pts[i]!, pts[i + 1]!, hw);
        }
        // 端点 cap
        const d0 = unitDir(pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1]);
        const off0 = normalOffset(pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1], hw);
        cap(pts[0]![0], pts[0]![1], -d0.x, -d0.y, off0.x, off0.y);
        const dLast = unitDir(pts[n - 2]![0], pts[n - 2]![1], pts[n - 1]![0], pts[n - 1]![1]);
        const offLast = normalOffset(pts[n - 2]![0], pts[n - 2]![1], pts[n - 1]![0], pts[n - 1]![1], hw);
        cap(pts[n - 1]![0], pts[n - 1]![1], dLast.x, dLast.y, offLast.x, offLast.y);
      }
    }
    this.recordFlat(iStart);
  }

  private joinCorner(p0: Pt2, p1: Pt2, p2: Pt2, hw: number): void {
    const e1x = p1[0] - p0[0];
    const e1y = p1[1] - p0[1];
    const e2x = p2[0] - p1[0];
    const e2y = p2[1] - p1[1];
    const l1 = Math.hypot(e1x, e1y);
    const l2 = Math.hypot(e2x, e2y);
    if (l1 < 1e-9 || l2 < 1e-9) return;
    const cross = e1x * e2y - e1y * e2x;
    const s = cross > 0 ? 1 : cross < 0 ? -1 : 0;
    if (s === 0) return;
    // 转角外侧单位法线：左转(s>0)取右法线；右转取左法线
    const outer = (ex: number, ey: number, inv: number) => (s > 0 ? { x: (ey / inv) * hw, y: (-ex / inv) * hw } : { x: (-ey / inv) * hw, y: (ex / inv) * hw });
    const o1 = outer(e1x, e1y, l1);
    const o2 = outer(e2x, e2y, l2);
    const ax = p1[0] + o1.x;
    const ay = p1[1] + o1.y;
    const bx = p1[0] + o2.x;
    const by = p1[1] + o2.y;

    if (this.state.lineJoin === "round") {
      const a0 = Math.atan2(ay - p1[1], ax - p1[0]);
      const a1 = Math.atan2(by - p1[1], bx - p1[0]);
      const fan = (cxa: number, cya: number) => {
        const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) / (Math.PI * 2)) * 64));
        const vc = this.pushFlat(cxa, cya);
        let prev = -1;
        for (let i = 0; i <= n; i++) {
          const t = a0 + ((a1 - a0) * i) / n;
          const v = this.pushFlat(p1[0] + Math.cos(t) * hw, p1[1] + Math.sin(t) * hw);
          if (prev >= 0) this.pushTri("flat", vc, prev, v);
          prev = v;
        }
      };
      fan(p1[0], p1[1]);
      return;
    }
    if (this.state.lineJoin === "miter") {
      const apex = lineIntersect(ax, ay, e1x, e1y, bx, by, e2x, e2y);
      if (apex) {
        const ratio = Math.hypot(apex.x - p1[0], apex.y - p1[1]) / hw;
        if (ratio <= this.state.miterLimit) {
          const va = this.pushFlat(ax, ay);
          const vb = this.pushFlat(bx, by);
          const vc = this.pushFlat(apex.x, apex.y);
          this.pushTri("flat", va, vb, vc);
          return;
        }
      }
    }
    // bevel（含 miter 超限回退）
    const va = this.pushFlat(ax, ay);
    const vb = this.pushFlat(bx, by);
    const vc = this.pushFlat(p1[0], p1[1]);
    this.pushTri("flat", va, vb, vc);
  }

  // ======================================================================
  // 裁剪（轴对齐矩形；scissor 语义为设备空间）
  // ======================================================================

  clipRect(x: number, y: number, w: number, h: number): this {
    if (w <= 0 || h <= 0) {
      this.state.clip = { x: 0, y: 0, w: 0, h: 0 };
      return this;
    }
    const corners: Pt2[] = [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [cx, cy] of corners) {
      const p = this.devPt(cx, cy);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const rect: DeviceRect = { x: Math.round(minX), y: Math.round(minY), w: Math.round(maxX - minX), h: Math.round(maxY - minY) };
    this.state.clip = this.state.clip ? intersectRects(this.state.clip, rect) : rect;
    return this;
  }

  /** 当前路径须为轴对齐矩形，否则提示改用 clipRect */
  clip(): this {
    const r = detectRectContour(this.path);
    if (!r) {
      throw new Error("[unidraw] clip() 目前仅支持轴对齐矩形路径；请使用 clipRect(x, y, w, h)");
    }
    const rect: DeviceRect = { x: r[0], y: r[1], w: r[2], h: r[3] };
    this.state.clip = this.state.clip ? intersectRects(this.state.clip, rect) : rect;
    return this;
  }

  // ======================================================================
  // 文本
  // ======================================================================

  fillText(text: string, x: number, y: number, maxWidth?: number): this {
    return this.drawText(text, x, y, maxWidth, 0);
  }

  /** 描边文字：字形由浏览器 `strokeText` 栅格化（轮廓质量与原生一致） */
  strokeText(text: string, x: number, y: number, maxWidth?: number): this {
    return this.drawText(text, x, y, maxWidth, this.state.lineWidth);
  }

  /** 文字度量（`width` 为前进宽度；字段名与原生 `TextMetrics` 对齐） */
  measureText(text: string): TextMetricsLike {
    return this.textRenderer.measure(text, this.state.font);
  }

  private drawText(text: string, x: number, y: number, maxWidth: number | undefined, strokeWidth: number): this {
    if (!text) return this;
    const glyph = this.textRenderer.getGlyph(text, this.state.font, strokeWidth);
    const m = this.textRenderer.measure(text, this.state.font);
    const style = strokeWidth > 0 ? this.state.strokeStyle : this.state.fillStyle;

    // textAlign / textBaseline：把「对齐点 + 基线」换算成图集左上角
    const align = this.state.textAlign;
    const alignOffsetX = align === "center" ? m.width / 2 : align === "right" || align === "end" ? m.width : 0;
    const baseline = this.state.textBaseline;
    const baselineOffset =
      baseline === "top" || baseline === "hanging"
        ? m.fontBoundingBoxAscent
        : baseline === "middle"
          ? (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2
          : baseline === "bottom" || baseline === "ideographic"
            ? -m.fontBoundingBoxDescent
            : 0;

    const left = x - alignOffsetX + glyph.offsetX;
    const top = y + baselineOffset + glyph.offsetY;
    // maxWidth：原生会横向压缩，这里按比例缩放四边形（视觉等价）
    const squeeze = maxWidth !== undefined && m.width > maxWidth && m.width > 0 ? maxWidth / m.width : 1;
    const w = glyph.width * squeeze;

    const iStart = this.textI.length;
    const v0 = this.pushTextV(left, top, 0, 0, style);
    const v1 = this.pushTextV(left + w, top, 1, 0, style);
    const v2 = this.pushTextV(left + w, top + glyph.height, 1, 1, style);
    const v3 = this.pushTextV(left, top + glyph.height, 0, 1, style);
    this.pushTri("text", v0, v1, v2);
    this.pushTri("text", v0, v2, v3);
    if (this.textI.length > iStart) {
      this.ops.push({ kind: "text", clip: this.state.clip ? { ...this.state.clip } : null, texture: glyph.texture, iStart, iEnd: this.textI.length });
    }
    return this;
  }

  clearTextCache(): void {
    this.textRenderer.clear();
  }
}
