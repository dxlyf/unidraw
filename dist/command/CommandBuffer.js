/**
 * 不可变命令缓冲：记录后可作为整体多次 submit。
 * 内容与后端无关（只持有句柄引用）。
 */
export class CommandBuffer {
    _ops;
    label;
    /** 内部构造：请通过 CommandEncoder.finish() 获取。 */
    constructor(ops, label) {
        this._ops = ops;
        this.label = label;
    }
    get ops() {
        return this._ops;
    }
    /** 命令数（可用于粗粒度统计/调试）。 */
    get opCount() {
        return this._ops.length;
    }
}
//# sourceMappingURL=CommandBuffer.js.map