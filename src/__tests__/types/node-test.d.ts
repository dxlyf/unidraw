/**
 * 轻量 ambient 类型：node --test / node:assert —— 避免引入 @types/node
 * 与 DOM lib 的全局冲突。仅覆盖本项目测试用到的最小面。
 */

declare module "node:test" {
  export interface TestContext {
    name: string;
    skip(message?: string): void;
    diagnostic(message: string): void;
  }
  type TestFn = (t: TestContext) => void | Promise<void>;
  export function test(name: string, fn: TestFn): void;
  export function test(name: string, options: { skip?: boolean | string }, fn: TestFn): void;
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: TestFn): void;
}

declare module "node:assert/strict" {
  export function ok(value: unknown, message?: string): asserts value;
  export function equal(actual: unknown, expected: unknown, message?: string): void;
  export function notEqual(actual: unknown, expected: unknown, message?: string): void;
  export function deepEqual(actual: unknown, expected: unknown, message?: string): void;
  export function strictEqual(actual: unknown, expected: unknown, message?: string): void;
  export function notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
  export function throws(block: () => unknown, message?: string): void;
  export function throws(block: () => unknown, error: new (...args: never[]) => Error, message?: string): void;
  export function fails(block: () => Promise<unknown>, message?: string): Promise<void>;
  export function match(value: string, regexp: RegExp, message?: string): void;
}
