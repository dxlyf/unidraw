/**
 * 分级日志：默认静默，显式开启（URL ?debug=1 或 setDevMode(true)）后输出。
 */
export enum LogLevel {
  Silent = 0,
  Error = 1,
  Warn = 2,
  Info = 3,
  Debug = 4,
}

let level: LogLevel = LogLevel.Silent;
const prefix = "%c[unidraw]";
const styles = {
  Error: "color:#e5484d;font-weight:bold",
  Warn: "color:#f5a623",
  Info: "color:#30a46c",
  Debug: "color:#8e8ea0",
} as const;

export function setLogLevel(next: LogLevel): void {
  level = next;
}

function out(logLevel: LogLevel, tag: keyof typeof styles, ...args: unknown[]): void {
  if (logLevel > level) return;
  const fn = logLevel === LogLevel.Error ? console.error : logLevel === LogLevel.Warn ? console.warn : console.log;
  // eslint-disable-next-line no-console
  fn(prefix, styles[tag], `[${tag.toLowerCase()}]`, ...args);
}

export const logger = {
  error: (...args: unknown[]) => out(LogLevel.Error, "Error", ...args),
  warn: (...args: unknown[]) => out(LogLevel.Warn, "Warn", ...args),
  info: (...args: unknown[]) => out(LogLevel.Info, "Info", ...args),
  debug: (...args: unknown[]) => out(LogLevel.Debug, "Debug", ...args),
};
