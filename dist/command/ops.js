/**
 * 统一命令定义：一次渲染的所有命令被记录为不可变 op 列表，
 * 后端（WebGL2/WebGPU/Mock）在 submit 时各自翻译执行。
 *
 * 每个 op 只引用“句柄”对象（Buffer/Texture/RenderPipeline/BindGroup），
 * 因此命令缓冲本身与后端无关 —— 这正是“一套统一绘制命令”的载体。
 */
/**
 * 一次 `setBindGroup` 最多支持的动态偏移个数。
 *
 * 内置布局最多用到 2 个：模型矩阵环（binding 1）+ 材质自己的动态块（如 ID 槽 binding 4）。
 * 需要更多时请扩展这个常量与 `RenderPassEncoder.setBindGroup` 的内联字段。
 */
export const MAX_DYNAMIC_OFFSETS = 2;
/** 从 op 里读出动态偏移（长度 = `offsetCount`；`out` 可复用以避免分配） */
export function readDynamicOffsets(op, out = []) {
    out.length = op.offsetCount;
    if (op.offsetCount > 0)
        out[0] = op.offset0;
    if (op.offsetCount > 1)
        out[1] = op.offset1;
    return out;
}
//# sourceMappingURL=ops.js.map