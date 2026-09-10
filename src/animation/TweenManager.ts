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

export class TweenManager {
  /** 完成后是否自动移除（默认 true） */
  autoRemove = true;
  readonly active: Tween<unknown>[] = [];

  get count(): number {
    return this.active.length;
  }

  /** 加入并自动 play() */
  add<T>(tween: Tween<T>): Tween<T> {
    this.active.push(tween as unknown as Tween<unknown>);
    tween.play();
    return tween;
  }

  remove<T>(tween: Tween<T>): boolean {
    const i = this.active.indexOf(tween as unknown as Tween<unknown>);
    if (i < 0) return false;
    this.active.splice(i, 1);
    return true;
  }

  /** 停止并清空全部 Tween */
  stopAll(): this {
    for (const t of this.active) t.stop();
    this.active.length = 0;
    return this;
  }

  /** 推进全部 Tween；返回仍在运行的数量 */
  update(dt: number): number {
    const list = this.active;
    let write = 0;
    for (let i = 0; i < list.length; i++) {
      const tween = list[i]!;
      const stillRunning = tween.update(dt);
      if (stillRunning) {
        list[write++] = tween;
      } else if (!this.autoRemove) {
        list[write++] = tween;
      }
    }
    list.length = write;
    return write;
  }
}
