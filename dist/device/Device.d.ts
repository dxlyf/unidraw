import { CommandEncoder, type CommandBuffer } from "../command/encoder.js";
import type { CommandOp } from "../command/ops.js";
import type { BindGroupDescriptor, BindGroupLayoutDescriptor, BufferDescriptor, ProgramDescriptor, RenderPipelineDescriptor, SamplerDescriptor, TextureDescriptor } from "./descriptors.js";
import { BindGroup, BindGroupLayout, Buffer, Program, RenderPipeline, ResourceBase, Sampler, Texture } from "./resources.js";
import type { BackendKind, TextureFormat } from "../gpu/types.js";
import type { ReadPixelsOptions } from "./readback.js";
export interface DeviceInfo {
    kind: BackendKind;
    /** 人类可读名称，例如 "WebGL2 (ANGLE ...)" */
    name: string;
    /** GPU 厂商/设备字符串（尽力而为） */
    adapter?: string;
}
export interface DeviceLimits {
    maxVertexAttributes: number;
    maxTextureUnits: number;
    maxUniformBufferBindings: number;
    maxTextureSize: number;
    maxCanvasSize?: number;
    /**
     * uniform buffer 动态偏移对齐（字节）。为动态偏移 UBO 分配环形槽时，
     * 相邻槽的间距必须是它的整数倍（WebGPU ≈ 256，WebGL2 由
     * `UNIFORM_BUFFER_OFFSET_ALIGNMENT` 决定）。
     */
    minUniformBufferOffsetAlignment?: number;
    /** 支持的最大 MSAA 采样数（1 = 不支持多重采样；缺省视为 1） */
    maxSamples?: number;
}
/**
 * 统一设备抽象：创建资源、编码并提交命令。
 *
 * 三种实现：
 * - WebGL2Device —— 同步 API 后端
 * - WebGPUDevice —— 异步 API 后端
 * - MockDevice   —— 无头 CPU 后端（测试 / SSR）
 */
export declare abstract class Device extends ResourceBase {
    readonly kind: BackendKind;
    readonly canvas: HTMLCanvasElement | null;
    readonly info: DeviceInfo;
    private readonly _resources;
    private readonly _beforeSubmit;
    private readonly _programCache;
    private readonly _pipelineCache;
    private _programsCreated;
    private _pipelinesCreated;
    private _submitCount;
    protected constructor(kind: BackendKind, canvas: HTMLCanvasElement | null, info: DeviceInfo);
    /**
     * 已提交次数。后端的 `submit()` 会 +1。
     *
     * 用途：判断「上一次提交是否已经发生」——提交之后写 buffer 才保证在队列时间线上
     * 晚于上一次提交的绘制，因此可以安全复用动态偏移 UBO 的槽位。
     */
    get submitCount(): number;
    /** @internal 由后端在真正提交后调用。 */
    protected markSubmitted(): void;
    abstract get limits(): DeviceLimits;
    abstract createBuffer(desc: BufferDescriptor): Buffer;
    abstract createTexture(desc: TextureDescriptor): Texture;
    abstract createSampler(desc: SamplerDescriptor): Sampler;
    /**
     * 创建着色器程序（**带内容缓存**）：源码完全相同的程序只创建一次。
     *
     * 典型场景：多个材质用同一套内置着色器（例如 25 个球各一个 `ColorMaterial`），
     * 缓存后 GL 程序 / WGSL 模块只编译一次。
     */
    createProgram(desc: ProgramDescriptor): Program;
    abstract createBindGroupLayout(desc: BindGroupLayoutDescriptor): BindGroupLayout;
    abstract createBindGroup(desc: BindGroupDescriptor): BindGroup;
    /**
     * 创建渲染管线（**带内容缓存**）：程序 + 顶点布局 + 光栅/深度/目标/采样数
     * 完全相同的管线只创建一次。
     */
    createRenderPipeline(desc: RenderPipelineDescriptor): RenderPipeline;
    /** 实际创建的着色器程序数量（去重后；调试/自检用） */
    get programsCreated(): number;
    /** 实际创建的渲染管线数量（去重后；调试/自检用） */
    get pipelinesCreated(): number;
    /** @internal 由后端实现：真正创建程序（不做缓存） */
    protected abstract createProgramNative(desc: ProgramDescriptor): Program;
    /** @internal 由后端实现：真正创建管线（不做缓存） */
    protected abstract createRenderPipelineNative(desc: RenderPipelineDescriptor): RenderPipeline;
    /** 创建命令编码器（与后端无关的通用实现）。 */
    createCommandEncoder(label?: string): CommandEncoder;
    /**
     * 提交命令缓冲。WebGL2 同步执行；WebGPU 异步执行；
     * Mock 在 CPU 状态模型上执行。可提交同一 CommandBuffer 多次（重放）。
     */
    submit(commandBuffers: readonly CommandBuffer[]): void;
    /** 等待本次提交的 GPU 工作完成。WebGL2/Mock 立即/下一微任务完成。 */
    abstract onSubmittedWorkDone(): Promise<void>;
    /** canvas 后备缓冲尺寸（未创建 canvas 的 Mock 返回 {width:0,height:0}）。 */
    abstract presentSize(): {
        width: number;
        height: number;
    };
    /** canvas 颜色格式；无 canvas 时返回 null。 */
    abstract canvasFormat(): TextureFormat | null;
    /**
     * 把纹理像素回读到 CPU（左上原点、紧凑 8bit RGBA）。
     *
     * 用途：GPU 颜色拾取、离屏渲染结果校验、截图/导出。
     * 仅支持 8bit 颜色纹理（rgba8unorm / bgra8unorm 系列）；
     * WebGPU 需要纹理带 `COPY_SRC`，WebGL2 通过临时 FBO 读取。
     */
    abstract readTexturePixels(texture: Texture, options?: ReadPixelsOptions): Promise<Uint8Array>;
    /**
     * 登记资源到设备生命周期（设备销毁时统一释放）。
     * @internal 由后端资源构造函数调用
     */
    register<T extends ResourceBase>(resource: T): T;
    /** 由后端实现：把统一命令翻译为原生调用。 */
    protected abstract executeOps(ops: readonly CommandOp[]): void;
    /**
     * 注册「提交前」回调：在 `submit()` 把命令交给 GPU **之前**执行。
     *
     * 用途：把一帧内累积的 UBO 写入合并成一次 `buffer.write`（逐 draw 写 64B 在
     * WebGPU 上是 6000 次队列操作，合并后只剩几次）；回调里写 buffer 在两种后端
     * 都保证先于本帧的 draw 生效（后端在 submit 时才翻译/编码命令）。
     *
     * @returns 取消注册
     */
    onBeforeSubmit(callback: () => void): () => void;
    /** @internal 由后端在提交前调用。 */
    protected runBeforeSubmitHooks(): void;
    destroy(): void;
    protected abstract destroyNative(): void;
}
/** 打印渲染统计（提交缓冲数等）的辅助类型，保留给调试面板使用。 */
export interface SubmitStats {
    commandBuffers: number;
    ops: number;
}
//# sourceMappingURL=Device.d.ts.map