/**
 * 轻量断言：仅执行必要校验，生产代码可裁剪。
 */
export declare class UnidrawError extends Error {
    constructor(message: string);
}
/** 开启开发模式校验（示例可在 URL ?debug=1 时调用）。 */
export declare function setDevMode(enabled: boolean): void;
/** 运行时断言，失败抛出 UnidrawError。 */
export declare function assert(condition: unknown, message: string): asserts condition;
/** 仅开发模式生效的断言。 */
export declare function devAssert(condition: unknown, message: string): asserts condition;
/** 检查一个值是有限数值。 */
export declare function assertFinite(value: number, label: string): void;
//# sourceMappingURL=assert.d.ts.map