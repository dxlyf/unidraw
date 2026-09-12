/**
 * TweenManager —— 统一推进一组 Tween（App 门面/示例里只需 update 一次）。
 *
 * ```ts
 * const tweens = new TweenManager();
 * tweens.add(tweenNumber(0, 1, 0.5, (v) => { ... }));
 * // 每帧：
 * tweens.update(dt);
 * ```
 * 已完成的 Tween 会自动移除（`autoRemove` 可关闭）。
 */
import type { Tween } from "./Tween.js";
export declare class TweenManager {
    /** 完成后是否自动移除（默认 true） */
    autoRemove: boolean;
    readonly active: Tween<unknown>[];
    get count(): number;
    /** 加入并自动 play() */
    add<T>(tween: Tween<T>): Tween<T>;
    remove<T>(tween: Tween<T>): boolean;
    /** 停止并清空全部 Tween */
    stopAll(): this;
    /** 推进全部 Tween；返回仍在运行的数量 */
    update(dt: number): number;
}
//# sourceMappingURL=TweenManager.d.ts.map