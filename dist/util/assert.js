/**
 * 轻量断言：仅执行必要校验，生产代码可裁剪。
 */
export class UnidrawError extends Error {
    constructor(message) {
        super(message);
        this.name = "UnidrawError";
    }
}
let devMode = false;
/** 开启开发模式校验（示例可在 URL ?debug=1 时调用）。 */
export function setDevMode(enabled) {
    devMode = enabled;
}
/** 运行时断言，失败抛出 UnidrawError。 */
export function assert(condition, message) {
    if (!condition) {
        throw new UnidrawError(`[unidraw] ${message}`);
    }
}
/** 仅开发模式生效的断言。 */
export function devAssert(condition, message) {
    if (!devMode)
        return;
    assert(condition, message);
}
/** 检查一个值是有限数值。 */
export function assertFinite(value, label) {
    if (!Number.isFinite(value)) {
        throw new UnidrawError(`[unidraw] ${label} 必须为有限数值，实际为 ${value}`);
    }
}
//# sourceMappingURL=assert.js.map