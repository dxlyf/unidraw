import type { CommandOp } from "./ops.js";

/**
 * 不可变命令缓冲：记录后可作为整体多次 submit。
 * 内容与后端无关（只持有句柄引用）。
 */
export class CommandBuffer {
  private readonly _ops: readonly CommandOp[];
  readonly label: string | undefined;

  /** 内部构造：请通过 CommandEncoder.finish() 获取。 */
  constructor(ops: readonly CommandOp[], label?: string) {
    this._ops = ops;
    this.label = label;
  }

  get ops(): readonly CommandOp[] {
    return this._ops;
  }

  /** 命令数（可用于粗粒度统计/调试）。 */
  get opCount(): number {
    return this._ops.length;
  }
}
