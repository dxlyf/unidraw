/**
 * 分级日志：默认静默，显式开启（URL ?debug=1 或 setDevMode(true)）后输出。
 */
export declare enum LogLevel {
    Silent = 0,
    Error = 1,
    Warn = 2,
    Info = 3,
    Debug = 4
}
export declare function setLogLevel(next: LogLevel): void;
export declare const logger: {
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
};
//# sourceMappingURL=logger.d.ts.map