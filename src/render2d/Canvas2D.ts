import type { Device } from "../device/Device.js";
import type { CommandEncoder, RenderPassEncoder } from "../command/encoder.js";
import type { Texture } from "../device/resources.js";
import type { BindGroup, BindGroupLayout, Buffer, Program, RenderPipeline, Sampler } from "../device/resources.js";
import { ColorWriteMask } from "../device/descriptors.js";
import { UniformBlock } from "../render/UniformBlock.js";
import { Mat4 } from "../math/mat4.js";
import { Color } from "../math/color.js";
import { BufferUsage, TextureUsage, type TextureFormat } from "../gpu/types.js";
import type { PaintStyle } from "./style.js";
import { sampleStyle } from "./style.js";
import { cssColorRgba, type GradientStop, type RGBA } from "./color.js";
import { LinearGradient } from "./LinearGradient.js";
import { RadialGradient } from "./RadialGradient.js";
import { CanvasPattern, type PatternRepetition } from "./pattern.js";
import { Path2D } from "./path.js";
import { fillTriangles, type FillRule } from "./fill.js";
import type { Contour } from "./pathTypes.js";
import { blendForComposite } from "./composite.js";
import { RenderTarget } from "../render/RenderTarget.js";
import { BlurPass } from "./blurPass.js";
import { CopyPass } from "../render/postfx/CopyPass.js";
import { STRAIGHT_OVER } from "../render/postfx/FullScreenPass.js";
import { BlendModePass, LayerPass, PREMULTIPLIED_OVER, dstTextureBlendIndex } from "./blendPass.js";
import { logger } from "../util/logger.js";
import { sourceSize, textureFromImageSource, type CanvasImageSourceLike } from "../render/texture/image.js";
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
 * 跨帧保留的阴影图层组上限（每组 = 一张全屏 MSAA 遮罩 + 一张结果纹理）。
 *
 * 超过就按 LRU 淘汰没被本帧用到的组 —— 阴影参数随帧变化时（动画阴影）不至于每帧
 * 都新建全屏目标把显存吃光。一帧内用到多少组就同时存在多少组（这是语义决定的）。
 */
const SHADOW_LAYER_CACHE = 4;

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
  /** 图案专用采样器（重复方式不同）；缺省用普通采样器 */
  sampler?: Sampler;
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
  private readonly flatPipelines = new Map<string, RenderPipeline>();
  private readonly texPipelines = new Map<string, RenderPipeline>();
  private sampler!: Sampler;
  private readonly textureGroups = new WeakMap<Texture, Map<Sampler, BindGroup>>();
  private pipelineFormat: string | null = null;
  /** 纯色绘制绑定的 1×1 白 LUT（着色器直接走顶点色，不采样渐变） */
  private solidLut!: Texture;
  /** 渐变 LUT 缓存（key = kind + stops，插入顺序即 LRU 顺序） */
  private readonly gradLuts = new Map<string, Texture>();
  /** 当前 `fill()/stroke()` 使用的画笔 */
  private paint: ResolvedPaint = SOLID_PAINT;
  /** 已告警过的不支持合成模式（每种只提醒一次） */
  private readonly warnedComposite = new Set<string>();
  /** 图像源 → 纹理缓存（同一个 img/canvas 反复绘制只上传一次） */
  private readonly imageTextures = new WeakMap<object, Texture>();
  /** 阴影遮罩（只存覆盖率）与模糊中转目标 */
  private shadowTmp: RenderTarget | null = null;

  private shadowBlurPass: BlurPass | null = null;
  private shadowCompositePass: CopyPass | null = null;
  /** 合成管线的「格式|采样数|翻转」键：调用方 pass 变了就得重建 */
  private shadowCompositeKey = "";
  /**
   * 本帧用到的阴影参数组：键 = `颜色|模糊|位移x|位移y`（op.shadow 存的就是这个键）。
   *
   * 每组一张遮罩是「按需现渲染现合成」，所以只需要一套遮罩/中转目标（`shadowMask`
   * / `shadowTmp`），组数再多也不涨显存。
   */
  private readonly shadowGroups = new Map<
    string,
    { r: number; g: number; b: number; a: number; blur: number; offsetX: number; offsetY: number; spread: number }
  >();
  /**
   * 每一组阴影的图层纹理（键与 `shadowGroups` 一致）。
   *
   * **必须每组一份**：图层渲染是当场 submit 的，而合成只是记进调用方的 pass、
   * 要等调用方 submit 才回放 —— 共用一张纹理会让后一组的遮罩覆写前一组的。
   *
   * 但**不能无限增长**：`shadowBlur`/`shadowOffsetX` 一旦随时间变化（动画阴影很常见），
   * 每帧的参数组键都不一样，于是每帧都会新建一整套全屏目标（MSAA 遮罩 + 结果），
   * 几秒钟就能把显存吃光 → 卡死。所以按 LRU 缓存，见 `pruneShadowLayers()`。
   */
  private readonly shadowLayers = new Map<string, { mask: RenderTarget; dst: RenderTarget | null; tinted: RenderTarget | null; texture: Texture }>();
  /** 本帧用到过的阴影组（这些不能在本帧淘汰：合成要等到回放时才读它们的纹理） */
  private readonly shadowLayersUsed = new Set<string>();
  /** 图层模式：本帧内容先画在这两张上 ping-pong（只在出现「目标当纹理」的混合模式时才建） */
  private layerA: RenderTarget | null = null;
  private layerB: RenderTarget | null = null;
  /** 图层模式：单个 op 的源图层（与目标图层混合用） */
  private layerSrc: RenderTarget | null = null;
  private layerSamples = 0;
  private blendModePass: BlendModePass | null = null;
  private layerPresentPass: LayerPass | null = null;
  private layerPassKey = "";
  private layerPresentKey = "";
  /** 图案采样器（按重复方式缓存） */
  private readonly patternSamplers = new Map<PatternRepetition, Sampler>();

  private viewW = 1;
  private viewH = 1;
  /** 逻辑像素（网页坐标）→ 物理像素的倍率，等价 `devicePixelRatio`；见 `setPixelRatio` */
  private ratioValue = 1;
  /** 默认投影缓存（key = 逻辑尺寸），避免每帧 new 一个 Mat4 */
  private defaultProj: Mat4 | null = null;
  private defaultProjKey = "";

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
    globalCompositeOperation: "source-over",
    shadowColor: "rgba(0,0,0,0)",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowSpread: 0,
    clip: null,
  };

  constructor(device: Device, options: Canvas2DOptions = {}) {
    this.device = device;
    if (options.vertexCapacity) {
      this.flatCap = Math.max(2048, options.vertexCapacity);
      this.textCap = Math.max(1024, options.vertexCapacity >> 1);
    }
    if (options.pixelRatio) this.setPixelRatio(options.pixelRatio);
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

  /** 取（或惰性创建）指定采样数 + 合成模式下的管线；格式固定为画布格式（与 MSAA 目标一致） */
  private pipelineFor(kind: "flat" | "tex", sampleCount: number, comp = "source-over"): RenderPipeline {
    const cache = kind === "flat" ? this.flatPipelines : this.texPipelines;
    const count = Math.max(1, Math.floor(sampleCount));
    const key = `${count}|${comp}`;
    let pipeline = cache.get(key);
    if (pipeline) return pipeline;
    const format = (this.pipelineFormat ?? this.device.canvasFormat() ?? "rgba8unorm") as Parameters<Device["createTexture"]>[0]["format"];
    const blend = blendForComposite(comp) ?? blendForComposite("source-over")!;
    const target = { format, writeMask: ColorWriteMask.ALL, blend };
    pipeline = this.device.createRenderPipeline({
      label: `2d-${kind}-pipe${count > 1 ? `-msaa${count}` : ""}${comp === "source-over" ? "" : `-${comp}`}`,
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
      cache.set(key, pipeline);
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
    if (style instanceof CanvasPattern) {
      // 图案：uv = 用户空间坐标 / 图案尺寸（kind 3），重复方式交给采样器寻址；
      // frame[6] 复用为「哪些轴重复」位标记（1=U, 2=V）。原生 no-repeat / repeat-x
      // 在**未平铺**的方向上是不画的（透明），而 CLAMP_TO_EDGE 会把边缘像素拉出去，
      // 所以着色器要据此把非重复轴的 [0,1] 之外裁掉。
      const repFlag =
        (style.repetition === "repeat" || style.repetition === "repeat-x" ? 1 : 0) +
        (style.repetition === "repeat" || style.repetition === "repeat-y" ? 2 : 0);
      return {
        kind: 3,
        frame: [0, 0, style.width, style.height, 0, 0, repFlag],
        lut: style.texture,
        sampler: style.sampler,
        vcolor: [1, 1, 1, alpha],
      };
    }
    // 字符串颜色走缓存解析（命名色/hsl 都认）；解析不了按「不画」处理
    if (typeof style === "string") {
      const c = cssColorRgba(style);
      return c
        ? { kind: 0, frame: [0, 0, 0, 0, 0, 0, 1], lut: null, vcolor: [c.r, c.g, c.b, c.a * alpha] }
        : { kind: 0, frame: [0, 0, 0, 0, 0, 0, 1], lut: null, vcolor: [0, 0, 0, 0] };
    }
    const c = style as Color;
    return { kind: 0, frame: [0, 0, 0, 0, 0, 0, 1], lut: null, vcolor: [c.r, c.g, c.b, c.a * alpha] };
  }

  /**
   * 创建图案（`createPattern`）：把图像当 `fillStyle` / `strokeStyle` 使用。
   *
   * `repetition`：`"repeat"` / `"repeat-x"` / `"repeat-y"` / `"no-repeat"`；
   * 图案锚定在**用户坐标系原点**（与原生一致），并且随 CTM 一起变换。
   */
  createPattern(source: CanvasImageSourceLike, repetition: PatternRepetition = "repeat"): CanvasPattern {
    const size = sourceSize(source);
    const rep: PatternRepetition =
      repetition === "repeat-x" || repetition === "repeat-y" || repetition === "no-repeat" ? repetition : "repeat";
    let sampler = this.patternSamplers.get(rep);
    if (!sampler) {
      sampler = this.device.createSampler({
        label: `2d-pattern-${rep}`,
        addressModeU: rep === "repeat" || rep === "repeat-x" ? "repeat" : "clamp-to-edge",
        addressModeV: rep === "repeat" || rep === "repeat-y" ? "repeat" : "clamp-to-edge",
        magFilter: "linear",
        minFilter: "linear",
        mips: false,
      });
      this.patternSamplers.set(rep, sampler);
    }
    return new CanvasPattern(source, rep, this.textureFor(source), sampler, size.width, size.height);
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
  /** 阴影颜色（CSS 颜色串）。默认 `rgba(0,0,0,0)` = 不画阴影，与原生一致。 */
  get shadowColor(): string {
    return this.state.shadowColor;
  }
  set shadowColor(v: string) {
    this.state.shadowColor = v;
  }
  /** 阴影模糊半径（像素，`0` = 硬边阴影）；内部按原生约定取 σ ≈ blur/2。 */
  get shadowBlur(): number {
    return this.state.shadowBlur;
  }
  set shadowBlur(v: number) {
    this.state.shadowBlur = v > 0 ? v : 0;
  }
  get shadowOffsetX(): number {
    return this.state.shadowOffsetX;
  }
  set shadowOffsetX(v: number) {
    this.state.shadowOffsetX = Number.isFinite(v) ? v : 0;
  }
  get shadowOffsetY(): number {
    return this.state.shadowOffsetY;
  }
  set shadowOffsetY(v: number) {
    this.state.shadowOffsetY = Number.isFinite(v) ? v : 0;
  }
  /** 阴影扩散（逻辑像素，0 = 不扩散）；框架扩展，原生 Canvas2D 没有 */
  get shadowSpread(): number {
    return this.state.shadowSpread;
  }
  set shadowSpread(v: number) {
    this.state.shadowSpread = v > 0 && Number.isFinite(v) ? v : 0;
  }
  /**
   * 合成模式（与原生同名）。
   *
   * 已支持：source-over / destination-over / source-in / destination-in / source-out /
   * destination-out / source-atop / destination-atop / xor / lighter / copy /
   * multiply / screen / darken / lighten（都是硬件混合状态，单 pass 完成）。
   * 其余模式（overlay / color-dodge / hard-light / difference / hue …）需要「以目标
   * 为输入的着色器」，会告警一次并回退到 source-over。
   */
  get globalCompositeOperation(): string {
    return this.state.globalCompositeOperation;
  }
  set globalCompositeOperation(v: string) {
    if (!blendForComposite(v) && dstTextureBlendIndex(v) < 0) {
      if (!this.warnedComposite.has(v)) {
        this.warnedComposite.add(v);
        logger.warn(
          `[unidraw] Canvas2D 暂不支持 globalCompositeOperation = "${v}"，已回退为 source-over。` +
            `支持的模式：source-over/destination-over/source-in/destination-in/source-out/destination-out/` +
            `source-atop/destination-atop/xor/lighter/copy/multiply/screen/darken/lighten，` +
            `以及 overlay/color-dodge/color-burn/hard-light/soft-light/difference/exclusion/hue/saturation/color/luminosity。`,
        );
      }
      this.state.globalCompositeOperation = "source-over";
      return;
    }
    this.state.globalCompositeOperation = v;
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
      globalCompositeOperation: this.state.globalCompositeOperation,
      shadowColor: this.state.shadowColor,
      shadowBlur: this.state.shadowBlur,
      shadowOffsetX: this.state.shadowOffsetX,
      shadowOffsetY: this.state.shadowOffsetY,
      shadowSpread: this.state.shadowSpread,
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
    this.shadowGroups.clear();
    this.shadowLayersUsed.clear();
    // 裁剪是“每帧重新建立”的状态：避免上一帧异常/未 restore 时把后续整帧都裁掉
    this.state.clip = null;
    this.path.begin();
    return this;
  }

  /**
   * 设置渲染目标的尺寸（**物理像素**：`canvas.width/height` 那种，scissor 与离屏图层
   * 都按它算）。用户坐标用哪套由 `setPixelRatio` 决定。
   */
  setViewportSize(width: number, height: number): this {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    if (w !== this.viewW || h !== this.viewH) this.defaultProjKey = "";
    this.viewW = w;
    this.viewH = h;
    return this;
  }

  /** 逻辑像素（网页坐标）→ 物理像素的倍率（等价 `devicePixelRatio`），默认 1 */
  get pixelRatio(): number {
    return this.ratioValue;
  }
  /**
   * 设置「逻辑像素 → 物理像素」的倍率，默认 1。
   *
   * 它决定**用户坐标系**的粒度：`fillRect(10, 10, …)` 里的 10 是 10 个**逻辑像素**
   * （网页/CSS 像素），高分屏上框架自己乘倍率画到物理像素 —— 于是同一段绘制代码在
   * 任何 DPR 下看起来一样大，和 DOM/CSS 的坐标语义一致。
   *
   * `setViewportSize()` 给的始终是**物理像素**。倍率同时作用于几何与裁剪的换算，
   * 所以 `clipRect` 也用逻辑像素写。
   */
  setPixelRatio(ratio: number): this {
    const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    if (r !== this.ratioValue) {
      this.ratioValue = r;
      this.defaultProjKey = "";
    }
    return this;
  }

  /**
   * 本帧的投影矩阵：给了就用给的，否则用**网页坐标系**。
   *
   * 默认投影 = 原点在**左上角**、**y 向下**、范围是视口的**物理尺寸**
   * （`setViewportSize` 给的）。用户坐标里的「逻辑像素」由 `pixelRatio` 在
   * `devPt` 那一步就乘成物理像素了，所以这里始终是物理像素到 NDC 的映射 ——
   * 于是 `fillRect(10, 10, 100, 50)` 会画在距左上角 (10, 10) 个**逻辑像素**处，
   * 与画在 DOM/原生 canvas 上的直觉一致。
   *
   * 要把 2D 当贴片画进 3D 场景（世界空间 HUD 等）时，自己传相机/自定义矩阵。
   */
  private resolveViewProj(viewProj?: Mat4): Mat4 {
    if (viewProj) return viewProj;
    const w = Math.max(1, this.viewW);
    const h = Math.max(1, this.viewH);
    const key = `${w}|${h}`;
    if (!this.defaultProj || this.defaultProjKey !== key) {
      // ortho(0, w, h, 0) 把 y 翻过来：y = 0 在顶部（网页坐标），y 增大向下
      this.defaultProj = Mat4.ortho(0, w, h, 0, -1, 1);
      this.defaultProjKey = key;
    }
    return this.defaultProj;
  }

  /**
   * 提交本帧。
   *
   * @param viewProj 2D → 裁剪空间的投影；**省略时用网页坐标系**（原点左上、y 向下、
   *   1 单位 = 1 逻辑像素，见 `setPixelRatio`）。
   */
  flush(pass: RenderPassEncoder, viewProj?: Mat4): void {
    if (this.ops.length === 0) return;
    this.viewBlock.setMat4("u_viewProj", this.resolveViewProj(viewProj));
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

    // 阴影走图层：遮罩/模糊各自独立 submit，产物不落在本 pass 上。
    // 按参数组登记（Set 保序 = 各组第一个 op 出现的先后），每组在它第一个 op 的位置
    // 现场渲染 + 合成：遮罩目标只有一套，组与组之间用完即覆盖。
    const shadowKeys: string[] = [];
    for (const op of this.ops) if (op.shadow !== undefined && !shadowKeys.includes(op.shadow)) shadowKeys.push(op.shadow);
    const pendingGroups = new Set(shadowKeys);

    // ---- 图层模式 ----
    // overlay / color-dodge / … / luminosity 这 11 种要把**目标**读成纹理，而目标就是
    // 调用方的 pass 附件（同一个 pass 里不能既当附件又当采样源）。所以这一帧整体改成
    // 「先画进自己的图层，最后再呈现到调用方 pass」；只有真的用到这些模式才切，普通帧
    // 的路径完全不变（也保证 Canvas2D 叠在 3D 场景上时照旧直接画进去）。
    const needsLayer = this.ops.some((op) => op.shadow === undefined && dstTextureBlendIndex(op.comp) >= 0);
    let layerFront: RenderTarget | null = null;
    let layerBack: RenderTarget | null = null;
    if (needsLayer) {
      const lw = Math.max(1, this.viewW);
      const lh = Math.max(1, this.viewH);
      const samples = Math.max(1, pass.sampleCount);
      if (this.layerSamples !== samples) {
        for (const t of [this.layerA, this.layerB, this.layerSrc]) t?.dispose();
        this.layerA = null;
        this.layerB = null;
        this.layerSrc = null;
        this.layerSamples = samples;
        this.layerPassKey = "";
        this.layerPresentKey = "";
      }
      layerFront = this.ensureLayerTarget("a", lw, lh, this.layerFormat(), samples);
      layerBack = this.ensureLayerTarget("b", lw, lh, this.layerFormat(), samples);
    }

    let lastClip: DeviceRect | null = null;
    let clipInit = false;
    /** 当前绑定在 binding 1 的纹理（渐变 LUT / 字形图集） */
    let lastTex: Texture | null = null;
    let lastSampler: Sampler | null = null;
    /** 当前管线（kind + 合成模式 + 采样数 的组合） */
    let lastPipeKey: string | null = null;

    // 图层的 pass **按需开**：混合 op 之后往往没有别的绘制了，提前开一个空 pass 会白做
    // 一次 MSAA 解析。开 pass 会重置管线/绑定/裁剪缓存，所以这里顺手把它们作废。
    let layerSink: RenderPassEncoder | null = null;
    let layerEnc: CommandEncoder | null = null;
    let layerStarted = false;
    const openLayer = (): RenderPassEncoder | null => {
      if (!needsLayer || !layerFront) return null;
      if (layerSink) return layerSink;
      layerEnc = this.device.createCommandEncoder("2d-layer");
      layerSink = layerEnc.beginRenderPass({
        label: "2d-layer",
        colorAttachments: [
          layerStarted
            ? layerFront.colorAttachment({ loadOp: "load" })
            : layerFront.colorAttachment({ clearValue: { r: 0, g: 0, b: 0, a: 0 } }),
        ],
        depthStencilAttachment: null,
      });
      layerStarted = true;
      lastPipeKey = null;
      lastTex = null;
      lastSampler = null;
      clipInit = false;
      return layerSink;
    };
    const closeLayer = (): void => {
      if (!layerSink || !layerEnc) return;
      layerSink.end();
      this.device.submit([layerEnc.finish()]);
      layerSink = null;
      layerEnc = null;
    };

    for (const op of this.ops) {
      if (op.shadow !== undefined) {
        // 合成位置 = **该组第一个 op 之前**：早于它会被本帧先画的背景 op 盖掉，
        // 晚于它就会盖住本体。合成会改掉 pass 的管线/绑定，所以缓存全部作废。
        if (pendingGroups.delete(op.shadow)) {
          this.renderShadowLayer(op.shadow, pass.sampleCount);
          const shadowSink = openLayer();
          this.compositeShadow(shadowSink ?? pass, op.shadow);
          lastPipeKey = null;
          lastTex = null;
          lastSampler = null;
          clipInit = false;
        }
        continue; // 阴影 op 只在遮罩图层里画
      }

      // 需要「目标当纹理」的混合模式：当前图层当 dst、这个 op 单独画一张 src，
      // 混合进另一张图层后继续在它上面画（ping-pong）。
      const blendIndex = dstTextureBlendIndex(op.comp);
      if (blendIndex >= 0 && layerFront && layerBack) {
        const lw = Math.max(1, this.viewW);
        const lh = Math.max(1, this.viewH);
        const samples = Math.max(1, pass.sampleCount);
        closeLayer();

        const srcLayer = this.ensureLayerTarget("src", lw, lh, this.layerFormat(), samples);
        const srcEnc = this.device.createCommandEncoder("2d-blend-src");
        const srcPass = srcEnc.beginRenderPass({
          label: "2d-blend-src",
          colorAttachments: [srcLayer.colorAttachment({ clearValue: { r: 0, g: 0, b: 0, a: 0 } })],
          depthStencilAttachment: null,
        });
        this.drawOpRaw(srcPass, op, samples);
        srcPass.end();
        this.device.submit([srcEnc.finish()]);

        const blendPass = this.ensureBlendModePass(this.layerFormat(), samples);
        const bEnc = this.device.createCommandEncoder("2d-blend");
        const bPass = bEnc.beginRenderPass({
          label: "2d-blend",
          colorAttachments: [layerBack.colorAttachment({ clearValue: { r: 0, g: 0, b: 0, a: 0 } })],
          depthStencilAttachment: null,
        });
        blendPass.drawBlend(bPass, layerFront.texture, srcLayer.texture, lw, lh, blendIndex, this.layerFlipY());
        bPass.end();
        this.device.submit([bEnc.finish()]);

        const swap = layerFront;
        layerFront = layerBack;
        layerBack = swap;
        continue;
      }

      const sink = openLayer() ?? pass;
      const c = op.clip;
      if (!clipInit || !sameClip(lastClip, c)) {
        if (c) sink.setScissorRect(c.x, c.y, c.w, c.h);
        else sink.setScissorRect(0, 0, this.viewW, this.viewH);
        lastClip = c;
        clipInit = true;
      }
      // 管线必须与 pass 的采样数匹配（WebGPU 校验），并且随合成模式变化
      const pipeKey = `${op.kind}|${op.comp}`;
      if (lastPipeKey !== pipeKey) {
        lastPipeKey = pipeKey;
        if (op.kind === "flat") {
          sink.setPipeline(this.pipelineFor("flat", pass.sampleCount, op.comp));
          if (this.flatVBuf && this.flatIBuf) {
            sink.setVertexBuffer(0, this.flatVBuf);
            sink.setIndexBuffer(this.flatIBuf, "uint16");
          }
        } else {
          sink.setPipeline(this.pipelineFor("tex", pass.sampleCount, op.comp));
          if (this.textVBuf && this.textIBuf) {
            sink.setVertexBuffer(0, this.textVBuf);
            sink.setIndexBuffer(this.textIBuf, "uint16");
          }
        }
      }
      // 纹理绑定逐 op 变化（每个渐变一张 LUT、每个字符串一张字形图集）
      const wantTex = (op.kind === "flat" ? (op.lut ?? this.solidLut) : op.texture) as Texture;
      const wantSampler = (op.kind === "flat" ? op.sampler : undefined) ?? this.sampler;
      if (lastTex !== wantTex || lastSampler !== wantSampler) {
        sink.setBindGroup(0, this.textureGroup(wantTex, wantSampler));
        lastTex = wantTex;
        lastSampler = wantSampler;
      }
      const n = op.iEnd - op.iStart;
      if (n > 0) sink.drawIndexed(n, 1, op.iStart, 0, 0);
    }

    // 图层模式收尾：把图层呈现到调用方 pass（预乘 over，透明处保留调用方原有内容）
    if (needsLayer && layerFront) {
      const lw = Math.max(1, this.viewW);
      const lh = Math.max(1, this.viewH);
      closeLayer();
      const present = this.ensureLayerPresentPass(this.layerFormat(), Math.max(1, pass.sampleCount));
      pass.setScissorRect(0, 0, lw, lh);
      present.drawLayer(pass, layerFront.texture, lw, lh, this.layerFlipY());
    }

    // 阴影图层目标按 LRU 回收（本帧用过的不能动：合成要等回放）
    if (this.shadowLayers.size > SHADOW_LAYER_CACHE) this.pruneShadowLayers();
  }

  /** 图层模式用的颜色格式（与调用方 pass 一致） */
  private layerFormat(): TextureFormat {
    return (this.pipelineFormat ?? this.device.canvasFormat() ?? "rgba8unorm") as TextureFormat;
  }

  /** 采样的是几何渲染出来的纹理，WebGPU 的行序反过来（与 `CopyPass.flipY` 同一套道理） */
  private layerFlipY(): boolean {
    return this.device.kind === "webgpu";
  }

  private ensureLayerTarget(which: "a" | "b" | "src", w: number, h: number, format: TextureFormat, sampleCount: number): RenderTarget {
    const cur = which === "a" ? this.layerA : which === "b" ? this.layerB : this.layerSrc;
    if (cur) {
      cur.resize(w, h);
      return cur;
    }
    const made = new RenderTarget(this.device, { label: `2d-layer-${which}`, width: w, height: h, format, depth: false, sampleCount });
    if (which === "a") this.layerA = made;
    else if (which === "b") this.layerB = made;
    else this.layerSrc = made;
    return made;
  }

  private ensureBlendModePass(format: TextureFormat, sampleCount: number): BlendModePass {
    const key = `${format}|${sampleCount}`;
    if (this.layerPassKey !== key || !this.blendModePass) {
      this.blendModePass?.dispose();
      this.blendModePass = new BlendModePass(this.device, format, sampleCount);
      this.layerPassKey = key;
    }
    return this.blendModePass;
  }

  private ensureLayerPresentPass(format: TextureFormat, sampleCount: number): LayerPass {
    const key = `${format}|${sampleCount}`;
    if (this.layerPresentKey !== key || !this.layerPresentPass) {
      this.layerPresentPass?.dispose();
      this.layerPresentPass = new LayerPass(this.device, format, sampleCount, PREMULTIPLIED_OVER);
      this.layerPresentKey = key;
    }
    return this.layerPresentPass;
  }

  /**
   * 把单个 op 按 **source-over** 画进目标（图层模式的源图层用）。
   *
   * 刻意忽略 op 自己的合成模式：源图层要的是「这个 op 画出来的原始颜色」，
   * 与目标的混合交给 `BlendModePass` 的着色器算。
   */
  private drawOpRaw(pass: RenderPassEncoder, op: Op, sampleCount: number): void {
    const c = op.clip;
    if (c) pass.setScissorRect(c.x, c.y, c.w, c.h);
    else pass.setScissorRect(0, 0, this.viewW, this.viewH);
    if (op.kind === "flat") {
      pass.setPipeline(this.pipelineFor("flat", sampleCount, "source-over"));
      if (this.flatVBuf && this.flatIBuf) {
        pass.setVertexBuffer(0, this.flatVBuf);
        pass.setIndexBuffer(this.flatIBuf, "uint16");
      }
    } else {
      pass.setPipeline(this.pipelineFor("tex", sampleCount, "source-over"));
      if (this.textVBuf && this.textIBuf) {
        pass.setVertexBuffer(0, this.textVBuf);
        pass.setIndexBuffer(this.textIBuf, "uint16");
      }
    }
    const wantTex = (op.kind === "flat" ? (op.lut ?? this.solidLut) : op.texture) as Texture;
    const wantSampler = (op.kind === "flat" ? op.sampler : undefined) ?? this.sampler;
    pass.setBindGroup(0, this.textureGroup(wantTex, wantSampler));
    const n = op.iEnd - op.iStart;
    if (n > 0) pass.drawIndexed(n, 1, op.iStart, 0, 0);
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

  /** 按（纹理 + 采样器）缓存 bind group（渐变 LUT / 字形图集 / 图案共用同一份布局） */
  private textureGroup(texture: Texture, sampler: Sampler = this.sampler): BindGroup {
    let bySampler = this.textureGroups.get(texture);
    if (!bySampler) {
      bySampler = new Map<Sampler, BindGroup>();
      this.textureGroups.set(texture, bySampler);
    }
    let g = bySampler.get(sampler);
    if (!g) {
      g = this.device.createBindGroup({
        layout: this.texLayout,
        entries: [
          { binding: 0, resource: this.viewBlock.buffer },
          { binding: 1, resource: texture.view() },
          { binding: 2, resource: sampler },
        ],
      });
      bySampler.set(sampler, g);
    }
    return g;
  }

  // ======================================================================
  // 顶点发射
  // ======================================================================

  /**
   * 用户坐标 → 设备（物理）像素。
   *
   * 这里顺带把 `pixelRatio` 作为**基准缩放**乘进去（等价于 CTM 底下垫一个
   * `scale(ratio)`）：几何、裁剪、文字、图片全都走这里，所以「逻辑像素」这套
   * 语义在整条链路上自洽。
   */
  private devPt(x: number, y: number): { x: number; y: number } {
    const r = this.ratioValue;
    return transformPoint(this.state.ctm, x * r, y * r, { x: 0, y: 0 });
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

  /** 文字四边形（字形图集遮罩 × 顶点色） */
  private pushTextQuad(left: number, top: number, w: number, h: number, style: PaintStyle): void {
    const v0 = this.pushTextV(left, top, 0, 0, style);
    const v1 = this.pushTextV(left + w, top, 1, 0, style);
    const v2 = this.pushTextV(left + w, top + h, 1, 1, style);
    const v3 = this.pushTextV(left, top + h, 0, 1, style);
    this.pushTri("text", v0, v1, v2);
    this.pushTri("text", v0, v2, v3);
  }
  private pushTri(arr: "flat" | "text", a: number, b: number, c: number): void {
    (arr === "flat" ? this.flatI : this.textI).push(a, b, c);
  }

  private recordFlat(iStart: number, polys?: readonly Pt2[][]): void {
    if (this.flatI.length > iStart) {
      this.ops.push({
        kind: "flat",
        clip: this.state.clip ? { ...this.state.clip } : null,
        iStart,
        iEnd: this.flatI.length,
        lut: this.paint.lut,
        sampler: this.paint.sampler,
        comp: this.state.globalCompositeOperation,
      });
    }
    // 需要把「形状之外」也按同一规则算掉的模式（copy / source-in / ...）：
    // 再画一块补集（画布矩形 − 路径），用完全透明的颜色走同一个混合状态。
    if (!polys || !blendForComposite(this.state.globalCompositeOperation)?.clearsOutside) return;
    const devPolys = polys.map((contour) =>
      contour.map(([x, y]) => {
        // 与 `devPt` 同一套换算（含 pixelRatio）
        const d = transformPoint(this.state.ctm, x * this.ratioValue, y * this.ratioValue, { x: 0, y: 0 });
        return [d.x, d.y] as Pt2;
      }),
    );
    const canvasRect: Pt2[] = [
      [0, 0],
      [this.viewW, 0],
      [this.viewW, this.viewH],
      [0, this.viewH],
    ];
    const tris = fillTriangles([canvasRect, ...devPolys], "evenodd");
    if (tris.length === 0) return;
    const savedPaint = this.paint;
    const jStart = this.flatI.length;
    this.paint = { kind: 0, frame: [0, 0, 0, 0, 0, 0, 1], lut: null, vcolor: [0, 0, 0, 0] };
    for (const tri of tris) {
      const ids: number[] = [
        this.pushFlatDevice(tri[0]![0], tri[0]![1]),
        this.pushFlatDevice(tri[1]![0], tri[1]![1]),
        this.pushFlatDevice(tri[2]![0], tri[2]![1]),
      ];
      this.pushTri("flat", ids[0]!, ids[1]!, ids[2]!);
    }
    this.paint = savedPaint;
    this.ops.push({
      kind: "flat",
      clip: this.state.clip ? { ...this.state.clip } : null,
      iStart: jStart,
      iEnd: this.flatI.length,
      lut: null,
      comp: this.state.globalCompositeOperation,
    });
  }

  /** 已经是**设备空间**坐标的顶点（补集四边形用，不再走 CTM） */
  private pushFlatDevice(x: number, y: number): number {
    const paint = this.paint;
    const v = this.flatV.length / 16;
    const c = paint.vcolor;
    const f = paint.frame;
    this.flatV.push(x, y, c[0], c[1], c[2], c[3], x, y, paint.kind, f[0], f[1], f[2], f[3], f[4], f[5], f[6]);
    return v;
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
  // ======================================================================
  // 阴影（shadowColor / shadowBlur / shadowOffsetX·Y）—— 图层方案
  // ======================================================================
  //
  // 与「把几何按高斯权重重画 N 次」的近似不同，这里走**真的高斯模糊**：
  //   ① 把阴影几何（白色 + 覆盖率）画进一张遮罩目标（独立 submit）；
  //   ② 横、竖各做一次 9-tap 可分离模糊（各一次独立 submit）；
  //   ③ 回到调用方的 pass：先用「阴影色 × 覆盖率」合成遮罩，再画本体。
  // 之所以每次都要独立 submit：WebGPU 不允许同一 submit 内某张纹理既作附件写入
  // 又被只读采样。
  //
  // 阴影按**参数组**（颜色+模糊+位移）分开：每组一张遮罩，并在「该组第一个 op」
  // 的位置依次合成。于是同一帧里 `shadowBlur=0` 的硬阴影不会被另一组的模糊半径带糊。
  //
  // 两条容易踩的坑（都踩过）：
  //   · **合成位置**必须落在该组第一个 op 之前：早了会被本帧先画的背景 op 盖掉，
  //     晚了就盖住本体；
  //   · **每组必须各留一份遮罩/结果纹理**：本文件里的 submit 是当场执行的，而合成
  //     只是记进调用方的 pass、要等调用方 submit 才回放 —— 共用一张纹理时，后一组
  //     的遮罩会把前一组的覆写掉，回放时所有合成读到的都是最后一组的内容
  //     （表现为「只有最后一个带阴影的图元有阴影」）。

  /** 阴影颜色解析缓存（颜色串 → RGBA）；`shadowColorRgba()` 每次 op 都会问 */
  private shadowColorKey = "";
  private shadowColorValue: RGBA = { r: 0, g: 0, b: 0, a: 0 };

  /**
   * `shadowColor` 解析结果（解析不了按全透明 = 不画阴影，不抛异常）。
   *
   * 每次 `fill()`/`stroke()`/`fillText()` 都会问一次「要不要阴影」，所以这里按
   * 颜色串缓存（颜色只在 `shadowColor` 变化时变）——不能每次都正则解析。
   */
  private shadowColorRgba(): RGBA {
    const s = this.state.shadowColor;
    if (s === this.shadowColorKey) return this.shadowColorValue;
    const c = cssColorRgba(s) ?? { r: 0, g: 0, b: 0, a: 0 };
    this.shadowColorKey = s;
    this.shadowColorValue = c;
    return c;
  }

  /** 当前是否要画阴影（`shadowColor` 透明 = 不画，与原生一致） */
  private shadowEnabled(): boolean {
    return this.shadowColorRgba().a > 0;
  }

  /**
   * 把「当前这一组阴影参数」登记进 `shadowGroups` 并返回它的键。
   *
   * 键同时充当 op 上的 `shadow` 标记：键相同 = 参数逐位相同 = 可以共用一张遮罩。
   */
  private shadowGroupKey(): string {
    const key = `${this.state.shadowColor}|${this.state.shadowBlur}|${this.state.shadowOffsetX}|${this.state.shadowOffsetY}|${this.state.shadowSpread}`;
    if (!this.shadowGroups.has(key)) {
      this.shadowGroups.set(key, {
        ...this.shadowColorRgba(),
        blur: this.state.shadowBlur,
        offsetX: this.state.shadowOffsetX,
        offsetY: this.state.shadowOffsetY,
        spread: this.state.shadowSpread,
      });
    }
    return key;
  }

  /**
   * 几何扩张：把一批轮廓向外扩 `radius`（用户单位）。
   *
   * 做法是多边形 ⊕ 圆盘的直接构造 —— 每条边外扩成一个四边形、每个顶点放一个圆盘，
   * 两者的并集就是扩张结果（凸/凹都成立；顶点密到一定程度后圆盘近似为圆）。
   * 只在**阴影遮罩**里用：比"用更大的模糊半径去凑扩散"便宜得多，
   * `shadowBlur = 0` 时更是零额外 pass。
   */
  private emitDilation(polys: readonly Pt2[][], radius: number): void {
    const SEG = 12; // 每个圆盘的分段（顶点很密，够用）
    const disc = (cx: number, cy: number) => {
      const center = this.pushFlat(cx, cy);
      let prev = -1;
      for (let i = 0; i <= SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        const v = this.pushFlat(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
        if (prev >= 0) this.pushTri("flat", center, prev, v);
        prev = v;
      }
    };
    for (const poly of polys) {
      const n = poly.length;
      if (n < 3) continue;
      for (let i = 0; i < n; i++) {
        const p = poly[i]!;
        const q = poly[(i + 1) % n]!;
        const off = normalOffset(p[0], p[1], q[0], q[1], radius);
        // 沿法线外扩的四边形（两侧各一条，保证并集覆盖整圈）
        const a = this.pushFlat(p[0] + off.x, p[1] + off.y);
        const b = this.pushFlat(q[0] + off.x, q[1] + off.y);
        const c = this.pushFlat(q[0] - off.x, q[1] - off.y);
        const d = this.pushFlat(p[0] - off.x, p[1] - off.y);
        this.pushTri("flat", a, b, c);
        this.pushTri("flat", a, c, d);
        disc(p[0], p[1]);
      }
    }
  }

  /** 把一批三角形按阴影位移画一次（白色 + 覆盖率），并单独记一个 shadow op */
  private emitShadowTris(tris: readonly Pt2[][], polys?: readonly Pt2[][]): void {
    if (!this.shadowEnabled() || tris.length === 0) return;
    const key = this.shadowGroupKey();
    // 必须是**副本**：`multiplyAffine(base, ...)` 会把结果写回 base，而 base 若与
    // `this.state.ctm` 是同一个对象，末尾的 `this.state.ctm = base` 就恢复不了 ——
    // 阴影位移会一路泄漏到后面每个 op（整幅图形被逐次推走）。
    const base = copyAffine(this.state.ctm);
    const start = this.flatI.length;
    this.paint = { kind: 0, frame: [0, 0, 0, 0, 0, 0, 1], lut: null, vcolor: [1, 1, 1, 1] };
    multiplyAffine(base, { a: 1, b: 0, c: 0, d: 1, e: this.state.shadowOffsetX, f: this.state.shadowOffsetY }, this.state.ctm);
    for (const tri of tris) {
      const ids: number[] = [this.pushFlat(tri[0]![0], tri[0]![1]), this.pushFlat(tri[1]![0], tri[1]![1]), this.pushFlat(tri[2]![0], tri[2]![1])];
      this.pushTri("flat", ids[0]!, ids[1]!, ids[2]!);
    }
    // 扩散：**几何**向外扩张（轮廓各边外扩成四边形 + 每个顶点画圆盘，并集即
    // 「多边形 ⊕ 半径 spread 的圆」），完全不额外增加 pass，也不靠模糊去凑。
    if (this.state.shadowSpread > 0 && polys) this.emitDilation(polys, this.state.shadowSpread);
    this.state.ctm = base;
    this.ops.push({
      kind: "flat",
      clip: this.state.clip ? { ...this.state.clip } : null,
      iStart: start,
      iEnd: this.flatI.length,
      lut: null,
      comp: "source-over",
      shadow: key,
    });
    void polys;
  }

  /** 文字阴影：字形图集本身就是 alpha 遮罩，白色顶点色即可写进阴影遮罩 */
  private emitShadowText(left: number, top: number, w: number, h: number, texture: Texture): void {
    if (!this.shadowEnabled()) return;
    const key = this.shadowGroupKey();
    // 同上：base 必须是副本，否则位移会泄漏到后续 op
    const base = copyAffine(this.state.ctm);
    const start = this.textI.length;
    multiplyAffine(base, { a: 1, b: 0, c: 0, d: 1, e: this.state.shadowOffsetX, f: this.state.shadowOffsetY }, this.state.ctm);
    this.pushTextQuad(left, top, w, h, "#ffffff");
    this.state.ctm = base;
    this.ops.push({
      kind: "text",
      clip: this.state.clip ? { ...this.state.clip } : null,
      texture,
      iStart: start,
      iEnd: this.textI.length,
      comp: "source-over",
      shadow: key,
    });
  }

  /** 只画某一组阴影 op 的迷你绘制循环（遮罩目标：source-over、纯白/字形遮罩） */
  private drawShadowOps(pass: RenderPassEncoder, groupKey: string, sampleCount: number, scale = 1): void {
    let lastKind: "flat" | "text" | null = null;
    let lastTex: Texture | null = null;
    for (const op of this.ops) {
      if (op.shadow !== groupKey) continue;
      // 裁剪矩形是全尺寸设备像素，遮罩缩小后要一起缩（scissor 永远是附件的物理像素）
      const c = op.clip;
      if (c) pass.setScissorRect(Math.round(c.x / scale), Math.round(c.y / scale), Math.max(1, Math.round(c.w / scale)), Math.max(1, Math.round(c.h / scale)));
      else pass.setScissorRect(0, 0, Math.max(1, Math.floor(this.viewW / scale)), Math.max(1, Math.floor(this.viewH / scale)));
      if (lastKind !== op.kind) {
        lastKind = op.kind;
        if (op.kind === "flat") {
          pass.setPipeline(this.pipelineFor("flat", sampleCount, "source-over"));
          if (this.flatVBuf && this.flatIBuf) {
            pass.setVertexBuffer(0, this.flatVBuf);
            pass.setIndexBuffer(this.flatIBuf, "uint16");
          }
        } else {
          pass.setPipeline(this.pipelineFor("tex", sampleCount, "source-over"));
          if (this.textVBuf && this.textIBuf) {
            pass.setVertexBuffer(0, this.textVBuf);
            pass.setIndexBuffer(this.textIBuf, "uint16");
          }
        }
      }
      const wantTex = (op.kind === "flat" ? this.solidLut : op.texture) as Texture;
      if (lastTex !== wantTex) {
        pass.setBindGroup(0, this.textureGroup(wantTex));
        lastTex = wantTex;
      }
      const n = op.iEnd - op.iStart;
      if (n > 0) pass.drawIndexed(n, 1, op.iStart, 0, 0);
    }
  }

  /** 某一组阴影的遮罩 + 模糊：三次独立 submit（遮罩 → 横向 → 纵向） */
  private renderShadowLayer(groupKey: string, sampleCount: number): void {
    const group = this.shadowGroups.get(groupKey);
    if (!group) return;
    const w = Math.max(1, this.viewW);
    const h = Math.max(1, this.viewH);
    const format = (this.pipelineFormat ?? this.device.canvasFormat() ?? "rgba8unorm") as TextureFormat;
    // 遮罩按**调用方的采样数**建：`shadowBlur = 0` 的硬阴影不做模糊，遮罩边缘就是
    // 最终边缘，1x 采样会留下明显锯齿（原生那条边是抗锯齿的）。MSAA 目标的
    // `texture` 是解析后的普通可采样纹理，所以后面照常采样。
    const samples = Math.max(1, Math.floor(sampleCount));
    /**
     * 大半径时遮罩按 1/scale 栅格化（等价「把轮廓缩小再模糊」，见下方模糊那段）：
     * scale 由阴影的**步长**（= blur/4，本来就是个"以像素计"的量）决定 ——
     * 步长 < 4 像素时 9-tap 采样已经很密，不需要降采样；≥ 12 像素时降到 1/4。
     */
    const stepPx = group.blur / 4;
    const scale = stepPx >= 12 ? 4 : stepPx >= 4 ? 2 : 1;
    const mw = Math.max(1, Math.floor(w / scale));
    const mh = Math.max(1, Math.floor(h / scale));

    // 关键：**每组各留一份遮罩/结果纹理**。
    // 本函数里的 submit 是立刻执行的，而「合成」只是记进调用方的 pass，要等调用方
    // 自己 submit 才执行 —— 共用一张纹理的话，后面几组会把前面几组的遮罩覆写掉，
    // 等到回放时所有合成读到的都是**最后一组**的内容（表现：只有最后一个带阴影的
    // 图元有阴影，其余全丢）。
    let layer = this.shadowLayers.get(groupKey) ?? null;
    if (layer) {
      // LRU：用到就挪到末尾
      this.shadowLayers.delete(groupKey);
      this.shadowLayers.set(groupKey, layer);
    }
    if (layer && layer.mask.sampleCount !== samples) {
      layer.mask.dispose();
      layer = null;
      this.shadowLayers.delete(groupKey);
    }
    if (!layer) {
      layer = {
        mask: new RenderTarget(this.device, { label: "2d-shadow-mask", width: mw, height: mh, format, depth: false, sampleCount: samples }),
        dst: null,
        tinted: null,
        texture: null as unknown as Texture,
      };
      this.shadowLayers.set(groupKey, layer);
    }
    this.shadowLayersUsed.add(groupKey);
    layer.mask.resize(mw, mh);
    const mask = layer.mask;

    const enc = this.device.createCommandEncoder("2d-shadow-mask");
    const p = enc.beginRenderPass({
      label: "2d-shadow-mask",
      colorAttachments: [mask.colorAttachment({ clearValue: { r: 0, g: 0, b: 0, a: 0 } })],
      depthStencilAttachment: null,
    });
    // 投影不变（世界坐标 [0..w]×[0..h]），视口小了 → 等于把轮廓缩小栅格化
    this.drawShadowOps(p, groupKey, samples, scale);
    p.end();
    this.device.submit([enc.finish()]);

    // blur = 0 时遮罩本身就是要的硬阴影，跳过模糊（同时也避开 radius→0 的数值问题）：
    // 只做一次「着色」把它变成直通 alpha 的阴影色图像。
    if (!(group.blur > 0)) {
      layer.texture = this.tintShadowLayer(layer, mask.texture, w, h, group);
      return;
    }
    // 模糊的每一趟都写**单采样**目标：遮罩是 MSAA 时不能当附件（模糊管线是 1x，
    // 采样数对不上 WebGPU 直接校验失败 → 整条命令缓冲作废）。中转目标 `tmp` 只在
    // 本函数内部用（合成不采样它），所以可以全局共用；结果 `dst` 要被合成采样，
    // 必须每组一份（同上面的理由）。
    if (!this.shadowBlurPass) this.shadowBlurPass = new BlurPass(this.device, format);
    // 9-tap 核自身 σ_k ≈ 2 个步长；原生 σ ≈ blur/2 → 步长 = blur/4
    const radius = Math.max(0.5, group.blur / 4);
    // **降采样**：9-tap 核只有 ±4 个 tap，步长一旦远大于 1 像素就是欠采样（大半径下
    // 会看出条带）。遮罩本身就按 1/scale 栅格化（相当于「把轮廓缩小再模糊」），
    // 再按缩小的步长模糊、最后由合成那张线性采样放大回来 —— 同一半径下每个目标像素
    // 覆盖的 tap 更密（条带明显减少），遮罩 + 两次模糊的计算量都降到 1/scale²。
    const bw = mw;
    const bh = mh;
    const tmp = this.ensureShadowTmp(bw, bh, format);
    if (layer.dst) layer.dst.resize(bw, bh);
    else layer.dst = new RenderTarget(this.device, { label: "2d-shadow-dst", width: bw, height: bh, format, depth: false, sampleCount: 1 });
    const dst = layer.dst;
    const iterations = 1;
    const step = radius / scale;
    let blurSrc: Texture = mask.texture;
    for (let it = 0; it < iterations; it++) {
      const steps: [Texture, RenderTarget, number, number][] = [
        [blurSrc, tmp, 1, 0],
        [tmp.texture, dst, 0, 1],
      ];
      for (const [source, target, dx, dy] of steps) {
        const e2 = this.device.createCommandEncoder("2d-shadow-blur");
        const p2 = e2.beginRenderPass({
          label: "2d-shadow-blur",
          colorAttachments: [target.colorAttachment({ clearValue: { r: 0, g: 0, b: 0, a: 0 } })],
          depthStencilAttachment: null,
        });
        this.shadowBlurPass.drawDirection(p2, source, bw, bh, dx, dy, step);
        p2.end();
        this.device.submit([e2.finish()]);
      }
      blurSrc = dst.texture;
    }
    layer.texture = this.tintShadowLayer(layer, dst.texture, bw, bh, group);
  }

  /**
   * 把覆盖率图**立刻**着色成「阴影色 + 直通 alpha」的图像（自身一次 submit）。
   *
   * 为什么必须在这里着色、而不是留到合成那一步：`FullScreenPass` 的 uniform 是
   * **记录时写、回放时才读**的 —— 同一个 pass 实例被多个阴影组复用时，所有 draw 只
   * 会看到最后一次写入的参数，多组阴影就会全部套上最后一组的颜色（影子串色）。
   * 这里每次 submit 都当场执行，参数用完即弃；留给调用方 pass 的那一步只剩一次
   * **参数恒定**的直通拷贝。
   */
  private tintShadowLayer(
    layer: { tinted: RenderTarget | null },
    source: Texture,
    w: number,
    h: number,
    group: { r: number; g: number; b: number; a: number },
  ): Texture {
    const format = (this.pipelineFormat ?? this.device.canvasFormat() ?? "rgba8unorm") as TextureFormat;
    if (!this.shadowBlurPass) this.shadowBlurPass = new BlurPass(this.device, format);
    if (layer.tinted) layer.tinted.resize(w, h);
    else layer.tinted = new RenderTarget(this.device, { label: "2d-shadow-tinted", width: w, height: h, format, depth: false, sampleCount: 1 });
    const target = layer.tinted;
    const enc = this.device.createCommandEncoder("2d-shadow-tint");
    const p = enc.beginRenderPass({
      label: "2d-shadow-tint",
      colorAttachments: [target.colorAttachment({ clearValue: { r: 0, g: 0, b: 0, a: 0 } })],
      depthStencilAttachment: null,
    });
    // radius = 0 → 9 个权重之和为 1：原样取覆盖率，只做着色
    this.shadowBlurPass.drawDirection(p, source, w, h, 1, 0, 0, group);
    p.end();
    this.device.submit([enc.finish()]);
    return target.texture;
  }

  /** 惰性创建/复用阴影模糊的横向中转目标（1x 单采样，全局共用） */
  private ensureShadowTmp(w: number, h: number, format: TextureFormat): RenderTarget {
    if (this.shadowTmp) this.shadowTmp.resize(w, h);
    else this.shadowTmp = new RenderTarget(this.device, { label: "2d-shadow-tmp", width: w, height: h, format, depth: false, sampleCount: 1 });
    return this.shadowTmp;
  }


  /**
   * 淘汰没被本帧用到的阴影图层目标（LRU，上限 `SHADOW_LAYER_CACHE`）。
   *
   * 为什么必须有：阴影参数里只要有一个随帧变化（动画的 `shadowOffsetX`/`shadowBlur`/
   * 半透明动画色），每帧的组键都不同，不淘汰就是**每帧新建一整套全屏 MSAA 目标**，
   * 显存几秒钟就被吃光、帧率断崖式下跌。淘汰只针对「本帧没用到」的组：本帧用过的
   * 组合成还没回放，纹理不能销毁。
   */
  private pruneShadowLayers(): void {
    for (const [key, layer] of this.shadowLayers) {
      if (this.shadowLayers.size <= SHADOW_LAYER_CACHE) break;
      if (this.shadowLayersUsed.has(key)) continue;
      layer.mask.dispose();
      layer.dst?.dispose();
      layer.tinted?.dispose();
      this.shadowLayers.delete(key);
    }
  }

  /**
   * 把某一组**已经着色好**的阴影图合成到调用方的 pass（source-over，直通 alpha）。
   *
   * 这里只做一次「参数恒定」的直通拷贝：参数只有一个 flip 标志，对所有组、所有帧都一样，
   * 所以同一个 pass 实例被复用时不会串（着色已经在 `tintShadowLayer` 里当场做完了）。
   */
  private compositeShadow(pass: RenderPassEncoder, groupKey: string): void {
    const layer = this.shadowLayers.get(groupKey);
    const tex = layer?.texture ?? null;
    if (!tex) return;
    const w = Math.max(1, this.viewW);
    const h = Math.max(1, this.viewH);
    const format = (this.pipelineFormat ?? this.device.canvasFormat() ?? "rgba8unorm") as TextureFormat;
    // 管线必须和调用方 pass 的附件状态一致：格式 + 采样数（MSAA 时是 4，不是 1）。
    // 翻转：着色已经多了一趟内部采样（见 tintShadowLayer），内部链的翻转奇偶性因此变化 ——
    // 现在 WebGL2 与 WebGPU 的取向一致，合成这步不再需要翻转。
    const key = `${format}|${pass.sampleCount}|flip0`;
    if (this.shadowCompositeKey !== key || !this.shadowCompositePass) {
      this.shadowCompositePass?.dispose();
      this.shadowCompositePass = new CopyPass(this.device, format, { sampleCount: pass.sampleCount, blend: STRAIGHT_OVER });
      this.shadowCompositeKey = key;
    }
    pass.setScissorRect(0, 0, w, h);
    this.shadowCompositePass.draw(pass, tex, w, h);
  }
  fill(rule: FillRule = "nonzero"): void {
    const contours = this.path.flatten(0.2);
    if (contours.length === 0) return;
    const polys: Pt2[][] = [];
    for (const contour of contours) {
      if (contour.points.length >= 3) polys.push(contour.points);
    }
    if (polys.length === 0) return;
    const tris = fillTriangles(polys, rule);
    const savedPaint = this.paint;
    this.emitShadowTris(tris, polys);
    this.paint = this.resolvePaint(this.state.fillStyle);
    const iStart = this.flatI.length;
    for (const tri of tris) {
      const ids: number[] = [this.pushFlat(tri[0]![0], tri[0]![1]), this.pushFlat(tri[1]![0], tri[1]![1]), this.pushFlat(tri[2]![0], tri[2]![1])];
      this.pushTri("flat", ids[0]!, ids[1]!, ids[2]!);
    }
    this.recordFlat(iStart, polys);
    this.paint = savedPaint;
  }

  // 便捷绘制
  fillRect(x: number, y: number, w: number, h: number): this {
    this.beginPath();
    this.rect(x, y, w, h);
    this.fill();
    return this;
  }
  /**
   * 把矩形清成**透明黑**（原生 `clearRect`）。
   *
   * 与原生一致的三条语义：
   * - **受**当前变换（`translate/rotate/scale`）与**裁剪**影响；
   * - **不受** `fillStyle` / `globalAlpha` / `shadow*` / 当前
   *   `globalCompositeOperation` 影响 —— 它就是把这块擦干净；
   * - 宽或高为 0 时什么都不做。
   *
   * 实现等价于「满覆盖率 + `destination-out`」：`dst = dst × (1 - 源 alpha)`，
   * 源 alpha 取 1，于是颜色与 alpha 一起归零，正好是透明黑。
   *
   * 另外它**不改动当前路径**（与原生一致，`fillRect` 那种先 `beginPath()` 的做法
   * 会清掉用户正在拼的路径，这里用一条临时路径）。
   */
  clearRect(x: number, y: number, w: number, h: number): this {
    if (!Number.isFinite(x + y + w + h) || w === 0 || h === 0) return this;
    const rectPath = new Path2D();
    rectPath.rect(x, y, w, h);
    const polys: Pt2[][] = [];
    for (const contour of rectPath.flatten(0.2)) {
      if (contour.points.length >= 3) polys.push(contour.points);
    }
    if (polys.length === 0) return this;
    const tris = fillTriangles(polys, "nonzero");
    if (tris.length === 0) return this;

    const savedPaint = this.paint;
    const savedComp = this.state.globalCompositeOperation;
    // 顶点色的 alpha 直接写 1（`pushFlat` 用的是 paint.vcolor），所以天然无视
    // globalAlpha；`destination-out` 只看源 alpha，颜色本身无所谓。
    this.paint = { kind: 0, frame: [0, 0, 0, 0, 0, 0, 1], lut: null, vcolor: [1, 1, 1, 1] };
    this.state.globalCompositeOperation = "destination-out";
    const iStart = this.flatI.length;
    for (const tri of tris) {
      const ids: number[] = [this.pushFlat(tri[0]![0], tri[0]![1]), this.pushFlat(tri[1]![0], tri[1]![1]), this.pushFlat(tri[2]![0], tri[2]![1])];
      this.pushTri("flat", ids[0]!, ids[1]!, ids[2]!);
    }
    this.recordFlat(iStart, polys);
    this.state.globalCompositeOperation = savedComp;
    this.paint = savedPaint;
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
    // 描边前先把**相邻重合点**去掉；闭合轮廓若末点等于首点也丢掉末点。
    //
    // 为什么必须做：`closePath()` 之前若最后一段正好回到起点（心形那种
    // 「moveTo(起) → 贝塞尔 → 回到起 → closePath()」的写法），闭合轮廓里就多出
    // 一条**零长收尾段**；`joinCorner` 里 e1 = p1 - p0 = 0 → 叉积为 0 → 直接 return，
    // 收尾那个 join 会被静默跳过（表现就是首尾没接好、缺一个接头）。
    const raw = this.path.flatten(0.2);
    for (const ct of raw) {
      const src = ct.points;
      const out: Pt2[] = [];
      for (let i = 0; i < src.length; i++) {
        const a = src[i]!;
        const b = out[out.length - 1];
        if (!b || Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-4) out.push(a);
      }
      if (ct.closed && out.length >= 2) {
        const a = out[0]!;
        const b = out[out.length - 1]!;
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-4) out.pop();
      }
      ct.points = out;
    }
    const contours = this.applyLineDash(raw);
    if (contours.length === 0) return;
    let hw = this.state.lineWidth / 2;
    const strokePolys: Pt2[][] = [];
    for (const c of contours) if (c.points.length >= 3) strokePolys.push(c.points);

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

    // 描边的**阴影**：原生 `stroke()` 同样投影。几何与本体完全一样，只是整体平移 +
    // 纯白覆盖率，所以把上面那段发射逻辑包成闭包跑两遍（阴影那遍先记 op，
    // 这样合成位置在本体之前 —— 否则阴影会盖住本体）。
    const emitStrokeGeometry = (): void => {
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
    };

    // 阴影的扩散在描边上就是「带子变宽」：半宽 + shadowSpread（带 ⊕ 圆盘 = 更宽的带）
    const bodyHw = hw;
    if (this.shadowEnabled() && this.state.shadowSpread > 0) hw = bodyHw + this.state.shadowSpread;
    this.emitShadowGeometry(emitStrokeGeometry, strokePolys);
    hw = bodyHw;

    this.paint = this.resolvePaint(this.state.strokeStyle);
    const bodyStart = this.flatI.length;
    emitStrokeGeometry();
    this.recordFlat(bodyStart, strokePolys);
  }

  /**
   * 把「一段几何发射逻辑」额外按阴影参数画一份（纯白覆盖率），并记一个 shadow op。
   *
   * `emit` 必须直接用 `this.paint` 推顶点；本方法负责换画笔、叠阴影位移、恢复 CTM。
   * 注意索引区间：阴影几何从**当前** `flatI` 长度开始，本体几何在调用之后另起一段
   * （调用方必须在本方法返回后重新取 `flatI.length` 作为本体的 iStart）。
   *
   * @returns 是否真的发射了阴影几何（没开阴影时 false）
   */
  private emitShadowGeometry(emit: () => void, polys: readonly Pt2[][]): boolean {
    if (!this.shadowEnabled()) return false;
    const key = this.shadowGroupKey();
    const start = this.flatI.length;
    const base = copyAffine(this.state.ctm);
    const savedPaint = this.paint;
    this.paint = { kind: 0, frame: [0, 0, 0, 0, 0, 0, 1], lut: null, vcolor: [1, 1, 1, 1] };
    multiplyAffine(base, { a: 1, b: 0, c: 0, d: 1, e: this.state.shadowOffsetX, f: this.state.shadowOffsetY }, this.state.ctm);
    emit();
    this.state.ctm = base;
    this.paint = savedPaint;
    this.ops.push({
      kind: "flat",
      clip: this.state.clip ? { ...this.state.clip } : null,
      iStart: start,
      iEnd: this.flatI.length,
      lut: null,
      comp: "source-over",
      shadow: key,
    });
    void polys;
    return true;
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
      // 圆弧必须经过**外角平分线**：直接取 a1−a0 时，atan2 在 ±π 处的分支会让某些角
      // 变成 1.5π（270°）→ 扇形走内侧长弧、外角那 90° 完全没被覆盖，留下 hw×hw 缺口。
      // 表现就是「同一个矩形的四个圆角，只有首尾那个（或某些角）缺一块」。
      const bisector = Math.atan2(o1.y + o2.y, o1.x + o2.x);
      let sweep = a1 - a0;
      if (Math.cos(a0 + sweep * 0.5 - bisector) < 0) {
        sweep = sweep > 0 ? sweep - Math.PI * 2 : sweep + Math.PI * 2;
      }
      const fan = (cxa: number, cya: number) => {
        const n = Math.max(2, Math.ceil((Math.abs(sweep) / (Math.PI * 2)) * 64));
        const vc = this.pushFlat(cxa, cya);
        let prev = -1;
        for (let i = 0; i <= n; i++) {
          const t = a0 + (sweep * i) / n;
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
    // 路径是用户坐标，scissor 要设备像素：走和 `clipRect` 同一套换算（含 pixelRatio）
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [cx, cy] of [
      [r[0], r[1]],
      [r[0] + r[2], r[1]],
      [r[0] + r[2], r[1] + r[3]],
      [r[0], r[1] + r[3]],
    ] as Pt2[]) {
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

  // ======================================================================
  // 图片
  // ======================================================================

  /**
   * 取图像源对应的纹理（按对象缓存；同一个 canvas/img 反复绘制只上传一次）。
   *
   * 注意：源内容变化后不会自动失效 —— 需要重新上传时调用 `invalidateImage(source)`。
   */
  private textureFor(source: CanvasImageSourceLike): Texture {
    const cached = this.imageTextures.get(source as object);
    if (cached) return cached;
    const tex = textureFromImageSource(this.device, source, { label: "2d-image" });
    this.imageTextures.set(source as object, tex);
    return tex;
  }

  /** 让图像源的缓存纹理失效（源内容变了要重新上传时调用） */
  invalidateImage(source: CanvasImageSourceLike): void {
    const tex = this.imageTextures.get(source as object);
    if (!tex) return;
    tex.destroy();
    this.imageTextures.delete(source as object);
  }

  /**
   * 绘制图像（三种重载与原生一致）：
   * `(img, dx, dy)` / `(img, dx, dy, dw, dh)` / `(img, sx, sy, sw, sh, dx, dy, dw, dh)`
   */
  drawImage(source: CanvasImageSourceLike, ...args: number[]): this {
    const size = sourceSize(source);
    let sx = 0;
    let sy = 0;
    let sw = size.width;
    let sh = size.height;
    let dx = 0;
    let dy = 0;
    let dw = 0;
    let dh = 0;
    if (args.length >= 8) {
      [sx, sy, sw, sh, dx, dy, dw, dh] = args as [number, number, number, number, number, number, number, number];
    } else if (args.length >= 4) {
      [dx, dy, dw, dh] = args as [number, number, number, number];
    } else if (args.length >= 2) {
      [dx, dy] = args as [number, number];
      dw = sw;
      dh = sh;
    } else {
      throw new Error("[unidraw] drawImage 参数数量不足");
    }
    if (!(dw > 0) || !(dh > 0) || !(sw > 0) || !(sh > 0)) return this;
    const tex = this.textureFor(source);
    const a = this.state.globalAlpha;
    const u0 = sx / size.width;
    const v0 = sy / size.height;
    const u1 = (sx + sw) / size.width;
    const v1 = (sy + sh) / size.height;
    const iStart = this.textI.length;
    const push = (x: number, y: number, u: number, v: number): number => {
      const p = this.devPt(x, y);
      const id = this.textV.length / 8;
      this.textV.push(p.x, p.y, u, v, 1, 1, 1, a);
      return id;
    };
    const v00 = push(dx, dy, u0, v0);
    const v10 = push(dx + dw, dy, u1, v0);
    const v11 = push(dx + dw, dy + dh, u1, v1);
    const v01 = push(dx, dy + dh, u0, v1);
    this.pushTri("text", v00, v10, v11);
    this.pushTri("text", v00, v11, v01);
    if (this.textI.length > iStart) {
      this.ops.push({
        kind: "text",
        clip: this.state.clip ? { ...this.state.clip } : null,
        texture: tex,
        iStart,
        iEnd: this.textI.length,
        comp: this.state.globalCompositeOperation,
      });
    }
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
    // 字形按**设备像素**栅格化：用户→设备的倍率 = pixelRatio × CTM 缩放。不这样做的话
    // 高分屏（或 `scale(2,2)`）上字形会先按逻辑尺寸栅格化再被放大 → 糊。
    const ctmScale = Math.hypot(this.state.ctm.a, this.state.ctm.b) || 1;
    const rasterScale = Math.min(8, Math.max(0.05, this.ratioValue * ctmScale));
    const glyph = this.textRenderer.getGlyph(text, this.state.font, strokeWidth, rasterScale);
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

    this.emitShadowText(left, top, w, glyph.height, glyph.texture);
    const iStart = this.textI.length;
    const v0 = this.pushTextV(left, top, 0, 0, style);
    const v1 = this.pushTextV(left + w, top, 1, 0, style);
    const v2 = this.pushTextV(left + w, top + glyph.height, 1, 1, style);
    const v3 = this.pushTextV(left, top + glyph.height, 0, 1, style);
    this.pushTri("text", v0, v1, v2);
    this.pushTri("text", v0, v2, v3);
    if (this.textI.length > iStart) {
      this.ops.push({ kind: "text", clip: this.state.clip ? { ...this.state.clip } : null, texture: glyph.texture, iStart, iEnd: this.textI.length, comp: this.state.globalCompositeOperation });
    }
    return this;
  }

  clearTextCache(): void {
    this.textRenderer.clear();
  }
}


