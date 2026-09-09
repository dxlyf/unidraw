/**
 * 轻量断言：仅执行必要校验，生产代码可裁剪。
 */
export class UnidrawError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnidrawError";
  }
}

let devMode = false;

/** 开启开发模式校验（示例可在 URL ?debug=1 时调用）。 */
export function setDevMode(enabled: boolean): void {
  devMode = enabled;
}

/** 运行时断言，失败抛出 UnidrawError。 */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new UnidrawError(`[unidraw] ${message}`);
  }
}

/** 仅开发模式生效的断言。 */
export function devAssert(condition: unknown, message: string): asserts condition {
  if (!devMode) return;
  assert(condition, message);
}

/** 检查一个值是有限数值。 */
export function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new UnidrawError(`[unidraw] ${label} 必须为有限数值，实际为 ${value}`);
  }
}
