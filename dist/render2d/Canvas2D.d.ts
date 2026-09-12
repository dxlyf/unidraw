import type { Device } from "../device/Device.js";
import type { RenderPassEncoder } from "../command/encoder.js";
import { Mat4 } from "../math/mat4.js";
import type { PaintStyle } from "./style.js";
import { CanvasPattern, type PatternRepetition } from "./pattern.js";
import { type FillRule } from "./fill.js";
import { type CanvasImageSourceLike } from "../render/texture/image.js";
import { type TextMetricsLike } from "./text.js";
import type { Canvas2DOptions, LineCap, LineJoin, TextAlign, TextBaseline } from "./types.js";
export declare class Canvas2D {
    private device;
    private textRenderer;
    private flatV;
    private flatI;
    private textV;
    private textI;
    private ops;
    private flatVBuf;
    private flatIBuf;
    private textVBuf;
    private textIBuf;
    private flatCap;
    private textCap;
    private viewBlock;
    private flatProgram;
    private texProgram;
    private texLayout;
    /**
     * 管线按**采样数**缓存。
     *
     * WebGPU 要求「管线声明的 `multisample.count` 必须与 render pass 的颜色附件一致」，
     * 而框架现在默认把一帧渲染进 4x MSAA 离屏目标（`RendererOptions.msaa`，默认 4）——
     * 所以 2D 也必须有 4x 版本，否则 WebGPU 直接校验失败、整层 2D 内容静默消失
     * （WebGL2 不校验，所以只在 WebGPU 上暴露）。
     */
    private readonly flatPipelines;
    private readonly texPipelines;
    private sampler;
    private readonly textureGroups;
    private pipelineFormat;
    /** 纯色绘制绑定的 1×1 白 LUT（着色器直接走顶点色，不采样渐变） */
    private solidLut;
    /** 渐变 LUT 缓存（key = kind + stops，插入顺序即 LRU 顺序） */
    private readonly gradLuts;
    /** 当前 `fill()/stroke()` 使用的画笔 */
    private paint;
    /** 已告警过的不支持合成模式（每种只提醒一次） */
    private readonly warnedComposite;
    /** 图像源 → 纹理缓存（同一个 img/canvas 反复绘制只上传一次） */
    private readonly imageTextures;
    /** 阴影遮罩（只存覆盖率）与模糊中转目标 */
    private shadowTmp;
    private shadowBlurPass;
    private shadowCompositePass;
    /** 合成管线的「格式|采样数|翻转」键：调用方 pass 变了就得重建 */
    private shadowCompositeKey;
    /**
     * 本帧用到的阴影参数组：键 = `颜色|模糊|位移x|位移y`（op.shadow 存的就是这个键）。
     *
     * 每组一张遮罩是「按需现渲染现合成」，所以只需要一套遮罩/中转目标（`shadowMask`
     * / `shadowTmp`），组数再多也不涨显存。
     */
    private readonly shadowGroups;
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
    private readonly shadowLayers;
    /** 本帧用到过的阴影组（这些不能在本帧淘汰：合成要等到回放时才读它们的纹理） */
    private readonly shadowLayersUsed;
    /** 图层模式：本帧内容先画在这两张上 ping-pong（只在出现「目标当纹理」的混合模式时才建） */
    private layerA;
    private layerB;
    /** 图层模式：单个 op 的源图层（与目标图层混合用） */
    private layerSrc;
    private layerSamples;
    private blendModePass;
    private layerPresentPass;
    private layerPassKey;
    private layerPresentKey;
    /** 图案采样器（按重复方式缓存） */
    private readonly patternSamplers;
    private viewW;
    private viewH;
    /** 逻辑像素（网页坐标）→ 物理像素的倍率，等价 `devicePixelRatio`；见 `setPixelRatio` */
    private ratioValue;
    /** 默认投影缓存（key = 逻辑尺寸），避免每帧 new 一个 Mat4 */
    private defaultProj;
    private defaultProjKey;
    private path;
    private stack;
    private state;
    constructor(device: Device, options?: Canvas2DOptions);
    private initResources;
    /** 取（或惰性创建）指定采样数 + 合成模式下的管线；格式固定为画布格式（与 MSAA 目标一致） */
    private pipelineFor;
    /**
     * 渐变 LUT：用浏览器的 `CanvasGradient` 光栅化成 512×1 纹理。
     *
     * 借原生实现生成 LUT 有两个好处：stop 之间的插值空间/取整规则与
     * 原生 Canvas2D **完全一致**，而且 CPU 侧不需要再实现一遍插值。
     * 按 `kind + stops` 缓存（同一渐变每帧重建也只光栅化一次）。
     */
    private gradientLut;
    /** 把当前样式解析成「顶点色 + 渐变几何 + LUT」 */
    private resolvePaint;
    /**
     * 创建图案（`createPattern`）：把图像当 `fillStyle` / `strokeStyle` 使用。
     *
     * `repetition`：`"repeat"` / `"repeat-x"` / `"repeat-y"` / `"no-repeat"`；
     * 图案锚定在**用户坐标系原点**（与原生一致），并且随 CTM 一起变换。
     */
    createPattern(source: CanvasImageSourceLike, repetition?: PatternRepetition): CanvasPattern;
    get fillStyle(): PaintStyle;
    set fillStyle(v: PaintStyle);
    get strokeStyle(): PaintStyle;
    set strokeStyle(v: PaintStyle);
    get globalAlpha(): number;
    set globalAlpha(v: number);
    get lineWidth(): number;
    set lineWidth(v: number);
    get lineCap(): LineCap;
    set lineCap(v: LineCap);
    get lineJoin(): LineJoin;
    set lineJoin(v: LineJoin);
    get miterLimit(): number;
    set miterLimit(v: number);
    get font(): string;
    set font(v: string);
    get textAlign(): TextAlign;
    set textAlign(v: TextAlign);
    get textBaseline(): TextBaseline;
    set textBaseline(v: TextBaseline);
    /** 虚线样式：空数组 = 实线（与原生 `setLineDash` 语义一致） */
    setLineDash(segments: readonly number[]): void;
    getLineDash(): number[];
    get lineDashOffset(): number;
    set lineDashOffset(v: number);
    /** 阴影颜色（CSS 颜色串）。默认 `rgba(0,0,0,0)` = 不画阴影，与原生一致。 */
    get shadowColor(): string;
    set shadowColor(v: string);
    /** 阴影模糊半径（像素，`0` = 硬边阴影）；内部按原生约定取 σ ≈ blur/2。 */
    get shadowBlur(): number;
    set shadowBlur(v: number);
    get shadowOffsetX(): number;
    set shadowOffsetX(v: number);
    get shadowOffsetY(): number;
    set shadowOffsetY(v: number);
    /** 阴影扩散（逻辑像素，0 = 不扩散）；框架扩展，原生 Canvas2D 没有 */
    get shadowSpread(): number;
    set shadowSpread(v: number);
    /**
     * 合成模式（与原生同名）。
     *
     * 已支持：source-over / destination-over / source-in / destination-in / source-out /
     * destination-out / source-atop / destination-atop / xor / lighter / copy /
     * multiply / screen / darken / lighten（都是硬件混合状态，单 pass 完成）。
     * 其余模式（overlay / color-dodge / hard-light / difference / hue …）需要「以目标
     * 为输入的着色器」，会告警一次并回退到 source-over。
     */
    get globalCompositeOperation(): string;
    set globalCompositeOperation(v: string);
    save(): void;
    restore(): void;
    translate(tx: number, ty: number): this;
    scale(sx: number, sy?: number): this;
    rotate(rad: number): this;
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): this;
    resetTransform(): this;
    beginPath(): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    quadraticCurveTo(x1: number, y1: number, x: number, y: number): this;
    bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this;
    arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw?: boolean): this;
    arcTo(x1: number, y1: number, x2: number, y2: number, r: number): this;
    ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw?: boolean): this;
    rect(x: number, y: number, w: number, h: number): this;
    roundRect(x: number, y: number, w: number, h: number, r: number | [number, number, number, number]): this;
    closePath(): this;
    begin(): this;
    /**
     * 设置渲染目标的尺寸（**物理像素**：`canvas.width/height` 那种，scissor 与离屏图层
     * 都按它算）。用户坐标用哪套由 `setPixelRatio` 决定。
     */
    setViewportSize(width: number, height: number): this;
    /** 逻辑像素（网页坐标）→ 物理像素的倍率（等价 `devicePixelRatio`），默认 1 */
    get pixelRatio(): number;
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
    setPixelRatio(ratio: number): this;
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
    private resolveViewProj;
    /**
     * 提交本帧。
     *
     * @param viewProj 2D → 裁剪空间的投影；**省略时用网页坐标系**（原点左上、y 向下、
     *   1 单位 = 1 逻辑像素，见 `setPixelRatio`）。
     */
    flush(pass: RenderPassEncoder, viewProj?: Mat4): void;
    /** 图层模式用的颜色格式（与调用方 pass 一致） */
    private layerFormat;
    /** 采样的是几何渲染出来的纹理，WebGPU 的行序反过来（与 `CopyPass.flipY` 同一套道理） */
    private layerFlipY;
    private ensureLayerTarget;
    private ensureBlendModePass;
    private ensureLayerPresentPass;
    /**
     * 把单个 op 按 **source-over** 画进目标（图层模式的源图层用）。
     *
     * 刻意忽略 op 自己的合成模式：源图层要的是「这个 op 画出来的原始颜色」，
     * 与目标的混合交给 `BlendModePass` 的着色器算。
     */
    private drawOpRaw;
    private ensureCapacity;
    private freeBuffers;
    /** 按（纹理 + 采样器）缓存 bind group（渐变 LUT / 字形图集 / 图案共用同一份布局） */
    private textureGroup;
    /**
     * 用户坐标 → 设备（物理）像素。
     *
     * 这里顺带把 `pixelRatio` 作为**基准缩放**乘进去（等价于 CTM 底下垫一个
     * `scale(ratio)`）：几何、裁剪、文字、图片全都走这里，所以「逻辑像素」这套
     * 语义在整条链路上自洽。
     */
    private devPt;
    /**
     * 按 `lineDash` / `lineDashOffset` 把轮廓切成实线段。
     *
     * 与原生一致：按**弧长**在压平后的折线上推进，奇数长度的模式复制一遍
     * （`[5]` ≡ `[5,5]`），`lineDashOffset` 表示从模式内的哪个距离开始；
     * 闭合轮廓会跨越起点继续（首段与末段共用同一个相位）。
     */
    private applyLineDash;
    /**
     * 发射一个「平铺」顶点（纯色或渐变，stride 64，见 shaders.ts）。
     *
     * 渐变不在顶点上采样颜色，只把**用户空间坐标**和渐变几何带下去，
     * 由片元着色器逐像素求 t 再查 LUT —— 这是与原生 Canvas2D 对齐的关键。
     */
    private pushFlat;
    private pushTextV;
    /** 文字四边形（字形图集遮罩 × 顶点色） */
    private pushTextQuad;
    private pushTri;
    private recordFlat;
    /** 已经是**设备空间**坐标的顶点（补集四边形用，不再走 CTM） */
    private pushFlatDevice;
    /**
     * 填充当前路径。
     *
     * @param rule 填充规则（默认 `"nonzero"`，与原生一致）：多子路径按规则求**精确**
     *   填充区域 —— 内环挖洞、重叠子路径只覆盖一次（半透明不会出现深色缝）、
     *   自相交路径也正确。
     */
    /** 阴影颜色解析缓存（颜色串 → RGBA）；`shadowColorRgba()` 每次 op 都会问 */
    private shadowColorKey;
    private shadowColorValue;
    /**
     * `shadowColor` 解析结果（解析不了按全透明 = 不画阴影，不抛异常）。
     *
     * 每次 `fill()`/`stroke()`/`fillText()` 都会问一次「要不要阴影」，所以这里按
     * 颜色串缓存（颜色只在 `shadowColor` 变化时变）——不能每次都正则解析。
     */
    private shadowColorRgba;
    /** 当前是否要画阴影（`shadowColor` 透明 = 不画，与原生一致） */
    private shadowEnabled;
    /**
     * 把「当前这一组阴影参数」登记进 `shadowGroups` 并返回它的键。
     *
     * 键同时充当 op 上的 `shadow` 标记：键相同 = 参数逐位相同 = 可以共用一张遮罩。
     */
    private shadowGroupKey;
    /**
     * 几何扩张：把一批轮廓向外扩 `radius`（用户单位）。
     *
     * 做法是多边形 ⊕ 圆盘的直接构造 —— 每条边外扩成一个四边形、每个顶点放一个圆盘，
     * 两者的并集就是扩张结果（凸/凹都成立；顶点密到一定程度后圆盘近似为圆）。
     * 只在**阴影遮罩**里用：比"用更大的模糊半径去凑扩散"便宜得多，
     * `shadowBlur = 0` 时更是零额外 pass。
     */
    private emitDilation;
    /** 把一批三角形按阴影位移画一次（白色 + 覆盖率），并单独记一个 shadow op */
    private emitShadowTris;
    /** 文字阴影：字形图集本身就是 alpha 遮罩，白色顶点色即可写进阴影遮罩 */
    private emitShadowText;
    /** 只画某一组阴影 op 的迷你绘制循环（遮罩目标：source-over、纯白/字形遮罩） */
    private drawShadowOps;
    /** 某一组阴影的遮罩 + 模糊：三次独立 submit（遮罩 → 横向 → 纵向） */
    private renderShadowLayer;
    /**
     * 把覆盖率图**立刻**着色成「阴影色 + 直通 alpha」的图像（自身一次 submit）。
     *
     * 为什么必须在这里着色、而不是留到合成那一步：`FullScreenPass` 的 uniform 是
     * **记录时写、回放时才读**的 —— 同一个 pass 实例被多个阴影组复用时，所有 draw 只
     * 会看到最后一次写入的参数，多组阴影就会全部套上最后一组的颜色（影子串色）。
     * 这里每次 submit 都当场执行，参数用完即弃；留给调用方 pass 的那一步只剩一次
     * **参数恒定**的直通拷贝。
     */
    private tintShadowLayer;
    /** 惰性创建/复用阴影模糊的横向中转目标（1x 单采样，全局共用） */
    private ensureShadowTmp;
    /**
     * 淘汰没被本帧用到的阴影图层目标（LRU，上限 `SHADOW_LAYER_CACHE`）。
     *
     * 为什么必须有：阴影参数里只要有一个随帧变化（动画的 `shadowOffsetX`/`shadowBlur`/
     * 半透明动画色），每帧的组键都不同，不淘汰就是**每帧新建一整套全屏 MSAA 目标**，
     * 显存几秒钟就被吃光、帧率断崖式下跌。淘汰只针对「本帧没用到」的组：本帧用过的
     * 组合成还没回放，纹理不能销毁。
     */
    private pruneShadowLayers;
    /**
     * 把某一组**已经着色好**的阴影图合成到调用方的 pass（source-over，直通 alpha）。
     *
     * 这里只做一次「参数恒定」的直通拷贝：参数只有一个 flip 标志，对所有组、所有帧都一样，
     * 所以同一个 pass 实例被复用时不会串（着色已经在 `tintShadowLayer` 里当场做完了）。
     */
    private compositeShadow;
    fill(rule?: FillRule): void;
    fillRect(x: number, y: number, w: number, h: number): this;
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
    clearRect(x: number, y: number, w: number, h: number): this;
    strokeRect(x: number, y: number, w: number, h: number): this;
    fillCircle(cx: number, cy: number, r: number): this;
    strokeCircle(cx: number, cy: number, r: number): this;
    stroke(): void;
    /**
     * 把「一段几何发射逻辑」额外按阴影参数画一份（纯白覆盖率），并记一个 shadow op。
     *
     * `emit` 必须直接用 `this.paint` 推顶点；本方法负责换画笔、叠阴影位移、恢复 CTM。
     * 注意索引区间：阴影几何从**当前** `flatI` 长度开始，本体几何在调用之后另起一段
     * （调用方必须在本方法返回后重新取 `flatI.length` 作为本体的 iStart）。
     *
     * @returns 是否真的发射了阴影几何（没开阴影时 false）
     */
    private emitShadowGeometry;
    private joinCorner;
    clipRect(x: number, y: number, w: number, h: number): this;
    /** 当前路径须为轴对齐矩形，否则提示改用 clipRect */
    clip(): this;
    /**
     * 取图像源对应的纹理（按对象缓存；同一个 canvas/img 反复绘制只上传一次）。
     *
     * 注意：源内容变化后不会自动失效 —— 需要重新上传时调用 `invalidateImage(source)`。
     */
    private textureFor;
    /** 让图像源的缓存纹理失效（源内容变了要重新上传时调用） */
    invalidateImage(source: CanvasImageSourceLike): void;
    /**
     * 绘制图像（三种重载与原生一致）：
     * `(img, dx, dy)` / `(img, dx, dy, dw, dh)` / `(img, sx, sy, sw, sh, dx, dy, dw, dh)`
     */
    drawImage(source: CanvasImageSourceLike, ...args: number[]): this;
    fillText(text: string, x: number, y: number, maxWidth?: number): this;
    /** 描边文字：字形由浏览器 `strokeText` 栅格化（轮廓质量与原生一致） */
    strokeText(text: string, x: number, y: number, maxWidth?: number): this;
    /** 文字度量（`width` 为前进宽度；字段名与原生 `TextMetrics` 对齐） */
    measureText(text: string): TextMetricsLike;
    private drawText;
    clearTextCache(): void;
}
//# sourceMappingURL=Canvas2D.d.ts.map