import type { RenderPassDescriptor } from "../device/descriptors.js";
import { CommandBuffer } from "./CommandBuffer.js";
import { RenderPassEncoder } from "./RenderPassEncoder.js";
/**
 * 命令编码器：记录一帧内的若干渲染通道。与后端无关。
 * 记录完成后 `finish()` 得到不可变 `CommandBuffer`。
 */
export declare class CommandEncoder {
    private _ops;
    private _activePass;
    private _finished;
    private _debugDepth;
    readonly label: string | undefined;
    constructor(label?: string);
    get finished(): boolean;
    private assertOpen;
    beginRenderPass(desc: RenderPassDescriptor): RenderPassEncoder;
    pushDebugGroup(label: string): void;
    popDebugGroup(): void;
    /** 完成编码，返回不可变命令缓冲。之后本 encoder 不可再使用。 */
    finish(): CommandBuffer;
}
//# sourceMappingURL=CommandEncoder.d.ts.map