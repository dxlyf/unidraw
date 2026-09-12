import { Device, DeviceLimits } from "../../Device.js";
import { BindGroup, BindGroupLayout, Buffer, Program, RenderPipeline, Sampler, Texture } from "../../resources.js";
import type { BindGroupDescriptor, BindGroupLayoutDescriptor, BufferDescriptor, ProgramDescriptor, RenderPipelineDescriptor, SamplerDescriptor, TextureDescriptor } from "../../descriptors.js";
import type { CommandOp } from "../../../command/ops.js";
import type { TextureFormat } from "../../../gpu/types.js";
import type { MockDrawCall } from "./types.js";
import { type ReadPixelsOptions } from "../../readback.js";
export declare class MockDevice extends Device {
    private _drawCalls;
    private _passCount;
    constructor();
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
    /** 测试断言：已记录的 draw 调用（累积，可用 clearDrawCalls 清空）。 */
    get drawCalls(): readonly MockDrawCall[];
    get passCount(): number;
    clearDrawCalls(): void;
    /** 读取颜色纹理的 CPU 像素（0..255）。 */
    readPixels(texture: Texture): Uint8Array | null;
    /** 统一回读接口：返回左上原点、紧凑 8bit RGBA 的子区域。 */
    readTexturePixels(texture: Texture, options?: ReadPixelsOptions): Promise<Uint8Array>;
    protected executeOps(ops: readonly CommandOp[]): void;
    private validateVertexBindings;
    private clearAttachment;
    private clearDepth;
    protected destroyNative(): void;
}
export { MOCK_CANVAS_FORMAT } from "./constants.js";
export type { MockDrawCall, MockIndexBufferBinding, MockVertexBufferBinding } from "./types.js";
//# sourceMappingURL=MockDevice.d.ts.map