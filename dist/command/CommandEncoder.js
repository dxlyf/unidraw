import { assert } from "../util/assert.js";
import { CommandBuffer } from "./CommandBuffer.js";
import { RenderPassEncoder } from "./RenderPassEncoder.js";
/**
 * 命令编码器：记录一帧内的若干渲染通道。与后端无关。
 * 记录完成后 `finish()` 得到不可变 `CommandBuffer`。
 */
export class CommandEncoder {
    _ops = [];
    _activePass = null;
    _finished = false;
    _debugDepth = 0;
    label;
    constructor(label) {
        this.label = label;
    }
    get finished() {
        return this._finished;
    }
    assertOpen() {
        assert(!this._finished, "CommandEncoder 已 finish，禁止继续记录");
        assert(this._activePass === null, "存在未 end 的 RenderPass");
    }
    beginRenderPass(desc) {
        this.assertOpen();
        const colorAttachments = desc.colorAttachments.map((att) => att === null
            ? null
            : {
                view: att.view,
                loadOp: att.loadOp ?? "clear",
                storeOp: att.storeOp ?? "store",
                clearValue: att.clearValue,
                resolveTo: att.resolveTo ?? null,
                sampleCount: att.sampleCount ?? 1,
            });
        const depth = desc.depthStencilAttachment;
        const depthOp = depth === null || depth === undefined
            ? null
            : {
                view: depth.view,
                depthLoadOp: depth.depthLoadOp ?? "clear",
                depthStoreOp: depth.depthStoreOp ?? "store",
                depthClearValue: depth.depthClearValue ?? 1,
                sampleCount: depth.sampleCount ?? 1,
            };
        this._ops.push({ k: "beginRenderPass", label: desc.label, colorAttachments, depthStencilAttachment: depthOp });
        // 附件的采样数：材质据此选择匹配的管线（WebGPU 要求管线 multisample.count 与附件一致）
        let sampleCount = depthOp?.sampleCount ?? 1;
        for (const att of colorAttachments)
            if (att)
                sampleCount = Math.max(sampleCount, att.sampleCount ?? 1);
        const pass = new RenderPassEncoder(this._ops, desc.label, sampleCount, () => {
            this._activePass = null;
        });
        this._activePass = pass;
        return pass;
    }
    pushDebugGroup(label) {
        this.assertOpen();
        this._ops.push({ k: "pushDebugGroup", label });
        this._debugDepth++;
    }
    popDebugGroup() {
        this.assertOpen();
        assert(this._debugDepth > 0, "popDebugGroup 与 pushDebugGroup 不匹配");
        this._ops.push({ k: "popDebugGroup" });
        this._debugDepth--;
    }
    /** 完成编码，返回不可变命令缓冲。之后本 encoder 不可再使用。 */
    finish() {
        assert(this._activePass === null, "finish 前必须 end 所有 RenderPass");
        assert(!this._finished, "CommandEncoder 已 finish");
        assert(this._debugDepth === 0, "pushDebugGroup/popDebugGroup 不匹配");
        this._finished = true;
        const buffer = new CommandBuffer(this._ops, this.label);
        this._ops = [];
        return buffer;
    }
}
//# sourceMappingURL=CommandEncoder.js.map