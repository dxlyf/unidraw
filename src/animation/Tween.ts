/**
 * Tween —— 轻量补间（不必写关键帧的常见动画）。
 *
 * 与 KeyframeTrack 的关系：Tween 复用了同一套「值类型」（线性插值/复制），
 * 只是把关键帧换成 `from → to` 两点 + 缓动 + 延迟 + 重复/往返。
 *
 * ```ts
 * const t = tweenNumber(0, 3, 1.2, (v) => mesh.setPosition(v, 0, 0))
 *   .easing("backOut").delay(0.2).yoyo().repeat(2);
 * t.play();
 * // 每帧：t.update(dt)  → 返回是否仍在运行
 * ```
 */

import { clamp } from "../math/mmath.js";
import { Color } from "../math/color.js";
import { Vec3 } from "../math/vec3.js";
import { Easing, type EasingFunction, type EasingName, resolveEasing } from "./easing.js";
import type { TrackValueType } from "./KeyframeTrack.js";
import { NumberTrackType } from "./NumberTrack.js";
import { Vec3TrackType } from "./Vec3Track.js";
import { ColorTrackType } from "./ColorTrack.js";

export interface TweenOptions<T> {
  from: T;
  to: T;
  /** 单程时长（秒） */
  duration: number;
  /** 值类型（决定插值/复制方式） */
  type: TrackValueType<T>;
  /** 写回目标 */
  write: (value: T) => void;
  /** 缓动（名称或函数，默认 linear） */
  easing?: EasingName | EasingFunction;
  /** 延迟（秒） */
  delay?: number;
  /** 重复次数（0 = 只播一次；Infinity = 无限） */
  repeat?: number;
  /** 往返（偶数次循环反向播回起点） */
  yoyo?: boolean;
  onUpdate?: (value: T, progress: number) => void;
  /** 每次循环结束时触发（含首次） */
  onRepeat?: (loop: number) => void;
  onComplete?: () => void;
}

export class Tween<T> {
  duration: number;
  delay: number;
  repeat: number;
  yoyo: boolean;
  easing: EasingName | EasingFunction;

  private readonly _from: T;
  private readonly _to: T;
  private readonly _type: TrackValueType<T>;
  private readonly _write: (value: T) => void;
  private _value: T;
  private _onUpdate: ((value: T, progress: number) => void) | undefined;
  private _onRepeat: ((loop: number) => void) | undefined;
  private _onComplete: (() => void) | undefined;
  private _time = 0;
  private _loop = 0;
  private _playing = false;
  private _finished = false;
  private _reverse = false;

  constructor(options: TweenOptions<T>) {
    this.duration = Math.max(0, options.duration);
    this.delay = Math.max(0, options.delay ?? 0);
    this.repeat = Math.max(0, options.repeat ?? 0);
    this.yoyo = options.yoyo ?? false;
    this.easing = options.easing ?? "linear";
    this._from = options.from;
    this._to = options.to;
    this._type = options.type;
    this._write = options.write;
    this._value = this._type.create(options.from);
    this._onUpdate = options.onUpdate;
    this._onRepeat = options.onRepeat;
    this._onComplete = options.onComplete;
  }

  // ---- 链式配置 -----------------------------------------------------------

  withEasing(easing: EasingName | EasingFunction): this {
    this.easing = easing;
    return this;
  }

  withDelay(delay: number): this {
    this.delay = Math.max(0, delay);
    return this;
  }

  withRepeat(repeat: number): this {
    this.repeat = Math.max(0, repeat);
    return this;
  }

  withYoyo(yoyo = true): this {
    this.yoyo = yoyo;
    return this;
  }

  onUpdate(cb: (value: T, progress: number) => void): this {
    this._onUpdate = cb;
    return this;
  }

  onRepeat(cb: (loop: number) => void): this {
    this._onRepeat = cb;
    return this;
  }

  onComplete(cb: () => void): this {
    this._onComplete = cb;
    return this;
  }

  // ---- 状态 ---------------------------------------------------------------

  get playing(): boolean {
    return this._playing;
  }

  get finished(): boolean {
    return this._finished;
  }

  /** 已完成的循环次数 */
  get loop(): number {
    return this._loop;
  }

  /** 当前（最近一次写回的）值 */
  get value(): T {
    return this._value;
  }

  /** 本次循环内的归一化进度 0..1 */
  get progress(): number {
    if (this.duration <= 0) return 1;
    return clamp(this._time / this.duration, 0, 1);
  }

  // ---- 控制 ---------------------------------------------------------------

  play(): this {
    this._playing = true;
    this._finished = false;
    return this;
  }

  stop(): this {
    this._playing = false;
    return this;
  }

  reset(): this {
    this._time = 0;
    this._loop = 0;
    this._reverse = false;
    this._finished = false;
    return this;
  }

  /** 立即跳到指定进度并写回（不改变播放状态） */
  seek(progress: number): this {
    this._time = clamp(progress, 0, 1) * this.duration;
    this._apply();
    return this;
  }

  /**
   * 推进补间。
   * @returns 是否仍在运行（false = 已完成或未播放）
   */
  update(dt: number): boolean {
    if (!this._playing) return false;
    if (this._finished) return false;

    if (this.delay > 0) {
      this.delay -= dt;
      if (this.delay > 0) return true;
      dt = -this.delay;
      this.delay = 0;
    }

    this._time += dt;
    while (this._time >= this.duration && this.duration >= 0) {
      const overshoot = this._time - this.duration;
      this._time = this.duration;
      this._apply();
      this._loop++;
      this._onRepeat?.(this._loop);
      if (this._loop > this.repeat) {
        this._finished = true;
        this._playing = false;
        this._onComplete?.();
        return false;
      }
      if (this.yoyo) this._reverse = !this._reverse;
      this._time = this.duration > 0 ? overshoot : 0;
      if (this.duration === 0) break;
    }
    this._apply();
    return true;
  }

  private _apply(): void {
    const raw = this.duration > 0 ? clamp(this._time / this.duration, 0, 1) : 1;
    const eased = resolveEasing(this.easing)(raw);
    const t = this._reverse ? 1 - eased : eased;
    // 标量类型的 lerp 返回新值（无法就地写），因此必须回填 _value
    this._value = this._type.lerp(this._from, this._to, t, this._value);
    this._write(this._value);
    this._onUpdate?.(this._value, raw);
  }
}

// ---------------------------------------------------------------------------
// 便捷工厂
// ---------------------------------------------------------------------------

export function tweenNumber(
  from: number,
  to: number,
  duration: number,
  write: (value: number) => void,
  options: Partial<Omit<TweenOptions<number>, "from" | "to" | "duration" | "type" | "write">> = {},
): Tween<number> {
  return new Tween<number>({ from, to, duration, type: NumberTrackType, write, ...options });
}

export function tweenVec3(
  from: Vec3,
  to: Vec3,
  duration: number,
  write: (value: Vec3) => void,
  options: Partial<Omit<TweenOptions<Vec3>, "from" | "to" | "duration" | "type" | "write">> = {},
): Tween<Vec3> {
  return new Tween<Vec3>({ from: from.clone(), to: to.clone(), duration, type: Vec3TrackType, write, ...options });
}

export function tweenColor(
  from: Color,
  to: Color,
  duration: number,
  write: (value: Color) => void,
  options: Partial<Omit<TweenOptions<Color>, "from" | "to" | "duration" | "type" | "write">> = {},
): Tween<Color> {
  return new Tween<Color>({ from: from.clone(), to: to.clone(), duration, type: ColorTrackType, write, ...options });
}

/** 常用缓动可直接用字符串名（等价 `withEasing("cubicOut")`） */
export { Easing };
