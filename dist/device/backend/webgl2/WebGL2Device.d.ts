import { Device, DeviceLimits } from "../../Device.js";
import { BindGroup, BindGroupLayout, Buffer, Program, RenderPipeline, Sampler, Texture } from "../../resources.js";
import type { BindGroupDescriptor, BindGroupLayoutDescriptor, BufferDescriptor, ProgramDescriptor, RenderPipelineDescriptor, SamplerDescriptor, TextureDescriptor } from "../../descriptors.js";
import type { CommandOp } from "../../../command/ops.js";
import type { TextureFormat } from "../../../gpu/types.js";
import type { GL } from "./glUtils.js";
import { type ReadPixelsOptions } from "../../readback.js";
export declare class WebGL2Device extends Device {
    readonly gl: GL;
    private _uniformBindingCursor;
    private _textureUnitCursor;
    private readonly _vaos;
    private readonly _fbos;
    /** MSAA renderbuffer 缓存（key: 格式|尺寸|采样数） */
    private readonly _renderbuffers;
    /** 当前绑定的 VAO（避免重复 bindVertexArray） */
    private _boundVao;
    /** 上一次绘制用的 VAO 及其指纹（大量 draw 时跳过 key 字符串构造） */
    private readonly _lastVao;
    private readonly _layoutCache;
    private readonly _uboFree;
    private readonly _texFree;
    private _scissorEnabled;
    private _limits;
    /** 是否支持把 RGBA16F/RGBA32F 当作颜色附件（构造时即请求，见构造函数注释） */
    private readonly _extColorBufferFloat;
    /** 深度回读用的可视化管线与目标（见 `readDepthPixels`） */
    private _depthVisProgram;
    private _depthVisProgramArray;
    private _depthVisTarget;
    private _depthVisSize;
    constructor(canvas: HTMLCanvasElement, options?: {
        antialias?: boolean;
        alpha?: boolean;
    });
    get limits(): DeviceLimits;
    createBuffer(desc: BufferDescriptor): Buffer;
    createTexture(desc: TextureDescriptor): Texture;
    createSampler(desc: SamplerDescriptor): Sampler;
    protected createProgramNative(desc: ProgramDescriptor): Program;
    createBindGroupLayout(desc: BindGroupLayoutDescriptor): BindGroupLayout;
    createBindGroup(desc: BindGroupDescriptor): BindGroup;
    protected createRenderPipelineNative(desc: RenderPipelineDescriptor): RenderPipeline;
    allocateUniformBinding(): number;
    allocateTextureUnit(): number;
    freeUniformBinding(point: number): void;
    freeTextureUnit(unit: number): void;
    /** 布局销毁时从缓存移除（避免复用已销毁布局）。 */
    dropLayoutCache(layout: BindGroupLayout): void;
    onSubmittedWorkDone(): Promise<void>;
    presentSize(): {
        width: number;
        height: number;
    };
    canvasFormat(): TextureFormat | null;
    /**
     * 纹理回读：绑定临时 FBO → `readPixels` → 按行序翻转 Y。
     * 注意：会临时切换绑定的 framebuffer，读取后恢复。
     *
     * **翻转规则（与 WebGPU 对齐的关键）**：
     * - 被当作渲染附件写过的纹理（`usedAsAttachment`）：GL 把画面顶部写进内存**最后**一行，
     *   所以要翻转才能得到「左上原点、第一行是画面顶部」的输出 —— WebGPU 无需翻转
     *   （它的 y=0 就是画面顶部），因此两侧输出一致；
     * - 只用 `upload()` 写入过的纹理：第 0 行落在内存第 0 行，翻转反而会得到上下颠倒的
     *   结果（WebGL2 与 WebGPU 的上传行序本来就是一致的），所以**不翻转**。
     *
     * 深度纹理不走 `readPixels`（Chrome 的 WebGL2 没实现这条路径，见 `depthVisualize.ts`），
     * 改为「可视化到 rgba32float 再按颜色回读」。
     */
    readTexturePixels(texture: Texture, options?: ReadPixelsOptions): Promise<Uint8Array>;
    /**
     * 深度回读：深度纹理 → （深度可视化 pass）→ rgba32float 颜色纹理 → 普通颜色回读。
     *
     * 结果布局与浮点深度回读一致：每纹素 16 字节，R = 深度，GBA = 0/0/1
     * （着色器直接写成这个布局），行序与颜色回读相同（左上原点，与 WebGPU 一致）。
     * 需要 `EXT_color_buffer_float`（rgba32float 可渲染）；没有扩展时明确报错，
     * 而不是静默返回全 0。
     */
    private readDepthPixels;
    /** 深度可视化用的着色器（GLSL，无顶点属性；分层用 sampler2DArray 版本） */
    private depthVisProgram;
    /** 深度可视化目标（rgba32float，按回读尺寸缓存一张） */
    private depthVisTarget;
    protected executeOps(ops: readonly CommandOp[]): void;
    /** 当前绑定的 VAO（`GLBuffer` 写索引缓冲时需要保存/恢复，见 `GLBuffer.elementBindingSafe`） */
    get boundVao(): WebGLVertexArrayObject | null;
    /** 应用管线静态状态（深度/剔除/混合）。 */
    private applyPipelineState;
    private bindGroup;
    private drawPrimitive;
    private vaoKey;
    private setupVao;
    /**
     * 把一张纹理的某一层挂到附件点上。
     *
     * 三种挂法不能混：cube 只能用**面目标**（`TEXTURE_CUBE_MAP_POSITIVE_X + layer`，
     * `framebufferTextureLayer` 对 cube 无效、FBO 会不完整）；2D 数组/3D 用
     * `framebufferTextureLayer`；普通 2D 用 `framebufferTexture2D`。
     */
    private attachTexture;
    private getFramebuffer;
    /**
     * 多重采样 attachment 用的 renderbuffer。
     *
     * **必须按纹理身份缓存，不能按 格式×尺寸×采样数 缓存**：那样「同尺寸同采样的多张
     * MSAA 目标」会共用同一个 renderbuffer，于是 A 的 pass 一清屏就把 B 的内容抹掉。
     * 一帧里只有一张 MSAA 目标时看不出问题，但 render2d 的阴影遮罩、图层模式的
     * ping-pong 图层都是同尺寸 MSAA 目标 —— 表现是「阴影渲染完之后图层内容全没了、
     * 整幅几乎空白」。纹理销毁时用 `releaseMsaaResources` 回收。
     */
    private getRenderbuffer;
    /** 纹理销毁时回收它独占的 renderbuffer 与相关 FBO（见 `getRenderbuffer` 的说明） */
    releaseMsaaResources(textureId: number): void;
    /** MSAA framebuffer：颜色/深度都用多重采样 renderbuffer；解析目标在 pass 结束时 blit。 */
    private getMsaaFramebuffer;
    /** 把多重采样附件解析（resolve）到普通纹理。 */
    private resolveMsaa;
    protected destroyNative(): void;
}
//# sourceMappingURL=WebGL2Device.d.ts.map