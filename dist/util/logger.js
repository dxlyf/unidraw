/**
 * 分级日志：默认静默，显式开启（URL ?debug=1 或 setDevMode(true)）后输出。
 */
export var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["Silent"] = 0] = "Silent";
    LogLevel[LogLevel["Error"] = 1] = "Error";
    LogLevel[LogLevel["Warn"] = 2] = "Warn";
    LogLevel[LogLevel["Info"] = 3] = "Info";
    LogLevel[LogLevel["Debug"] = 4] = "Debug";
})(LogLevel || (LogLevel = {}));
let level = LogLevel.Silent;
const prefix = "%c[unidraw]";
const styles = {
    Error: "color:#e5484d;font-weight:bold",
    Warn: "color:#f5a623",
    Info: "color:#30a46c",
    Debug: "color:#8e8ea0",
};
export function setLogLevel(next) {
    level = next;
}
function out(logLevel, tag, ...args) {
    if (logLevel > level)
        return;
    const fn = logLevel === LogLevel.Error ? console.error : logLevel === LogLevel.Warn ? console.warn : console.log;
    // eslint-disable-next-line no-console
    fn(prefix, styles[tag], `[${tag.toLowerCase()}]`, ...args);
}
export const logger = {
    error: (...args) => out(LogLevel.Error, "Error", ...args),
    warn: (...args) => out(LogLevel.Warn, "Warn", ...args),
    info: (...args) => out(LogLevel.Info, "Info", ...args),
    debug: (...args) => out(LogLevel.Debug, "Debug", ...args),
};
//# sourceMappingURL=logger.js.map