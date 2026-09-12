import { Device, DeviceLimits } from "../../Device.js";
import { BindGroup, BindGroupLayout, Buffer, Program, RenderPipeline, Sampler, Texture } from "../../resources.js";
import type { BindGroupDescriptor, BindGroupLayoutDescriptor, BufferDescriptor, ProgramDescriptor, RenderPipelineDescriptor, SamplerDescriptor, TextureDescriptor } from "../../descriptors.js";
import type { CommandBuffer } from "../../../command/encoder.js";
import type { CommandOp } from "../../../command/ops.js";
import type { TextureFormat } from "../../../gpu/types.js";
import type { WebGPUDeviceOptions } from "./types.js";
import { type ReadPixelsOptions } from "../../readback.js";
export declare class WebGPUDevice extends Device {
    readonly gpu: GPUDevice;
    readonly adapter: GPUAdapter;
    readonly context: GPUCanvasContext;
    readonly canvasFormatNative: GPUTextureFormat;
    private _internalDepth;
    private _internalDepthW;
    private _internalDepthH;
    private _configuredW;
    private _configuredH;
    private readonly _layoutCache;
    /** 动态偏移读取的复用缓冲（避免每次 setBindGroup 分配数组） */
    private readonly _offsetScratch;
    private _limits;
    private constructor();
    private configureContext;
    static create(canvas: HTMLCanvasElement, options?: WebGPUDeviceOptions): Promise<WebGPUDevice>;
    get limits(): DeviceLimits;
    createBuffer(desc: BufferDescriptor): Buffer;
    createTexture(desc: TextureDescriptor): Texture;
    createSampler(desc: SamplerDescriptor): Sampler;
    protected createProgramNative(desc: ProgramDescriptor): Program;
    createBindGroupLayout(desc: BindGroupLayoutDescriptor): BindGroupLayout;
    createBindGroup(desc: BindGroupDescriptor): BindGroup;
    protected createRenderPipelineNative(desc: RenderPipelineDescriptor): RenderPipeline;
    onSubmittedWorkDone(): Promise<void>;
    presentSize(): {
        width: number;
        height: number;
    };
    canvasFormat(): TextureFormat | null;
    /**
     * 纹理回读：`copyTextureToBuffer` + `mapAsync`。
     * WebGPU 要求每行字节数为 256 的倍数，因此回读缓冲带行间距，之后重排为紧凑 RGBA。
     *
     * 深度/模板格式与多重采样纹理还要求 copy **覆盖整个子资源**（整幅宽高），所以这两类
     * 只能先整幅拷回、再在 CPU 上裁出请求的区域；否则 WebGPU 直接报校验错误、缓冲为 0。
     */
    readTexturePixels(texture: Texture, options?: ReadPixelsOptions): Promise<Uint8Array>;
    submit(commandBuffers: readonly CommandBuffer[]): void;
    protected executeOps(ops: readonly CommandOp[]): void;
    private encodeOps;
    private acquireCanvasTexture;
    /** 解析深度附件：view null 表示设备内部画布深度纹理。 */
    private resolveDepthAttachment;
    /** 懒创建随画布尺寸变化的内部深度纹理。 */
    private internalDepthTexture;
    protected destroyNative(): void;
}
export { WEBGPU_INTERNAL_DEPTH_FORMAT } from "./constants.js";
export { isWebGPUSupported } from "./gpuUtils.js";
export type { WebGPUDeviceOptions } from "./types.js";
//# sourceMappingURL=WebGPUDevice.d.ts.map