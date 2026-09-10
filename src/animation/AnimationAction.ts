/**
 * AnimationAction —— Mixer 中「一个片段的播放实例」。
 *
 * 负责时间推进（含循环模式/时间缩放/淡入淡出）与写回（委托给 Clip 的轨道）。
 */

import { clamp } from "../math/mmath.js";
import type { AnimationClip } from "./AnimationClip.js";

export type LoopMode = "once" | "repeat" | "ping-pong";

export interface AnimationActionOptions {
  /** 循环模式（默认 "repeat"） */
  loop?: LoopMode;
  /** 循环次数（默认 Infinity；"once" 忽略） */
  repetitions?: number;
  /** 时间缩放（负值倒放） */
  timeScale?: number;
  /** 权重（0..1，用于淡入淡出/叠加） */
  weight?: number;
  /** 播完是否停在末帧（默认 true；false 则回到初始值） */
  clampWhenFinished?: boolean;
  /** 创建后立即播放（默认 false，由 mixer.play() 处理） */
  autoPlay?: boolean;
}

export class AnimationAction {
  readonly clip: AnimationClip;
  loop: LoopMode;
  repetitions: number;
  timeScale: number;
  weight: number;
  enabled = true;
  paused = false;
  clampWhenFinished: boolean;

  private _time = 0;
  private _direction: 1 | -1 = 1;
  private _loopsDone = 0;
  private _running: boolean;
  private _finished = false;
  private _fadeDuration = 0;
  private _fadeElapsed = 0;
  private _fadeFrom = 1;
  private _fadeTo = 1;
  private readonly _finishedCallbacks: (() => void)[] = [];

  constructor(clip: AnimationClip, options: AnimationActionOptions = {}) {
    this.clip = clip;
    this.loop = options.loop ?? "repeat";
    this.repetitions = options.repetitions ?? Number.POSITIVE_INFINITY;
    this.timeScale = options.timeScale ?? 1;
    this.weight = options.weight ?? 1;
    this.clampWhenFinished = options.clampWhenFinished ?? true;
    this._running = options.autoPlay ?? false;
  }

  // ---- 状态 ---------------------------------------------------------------

  get duration(): number {
    return this.clip.effectiveDuration;
  }

  /** 当前播放时间（秒） */
  get time(): number {
    return this._time;
  }
  set time(value: number) {
    this._time = clamp(value, 0, this.duration);
  }

  /** 归一化进度 0..1 */
  get progress(): number {
    const d = this.duration;
    return d > 0 ? this._time / d : 1;
  }

  get running(): boolean {
    return this._running;
  }

  get finished(): boolean {
    return this._finished;
  }

  /** 已完成的循环次数 */
  get loopCount(): number {
    return this._loopsDone;
  }

  /** 当前播报方向（ping-pong 下会翻转） */
  get direction(): 1 | -1 {
    return this._direction;
  }

  /** 有效权重（用户权重 × 淡入淡出系数） */
  get effectiveWeight(): number {
    const f = this._fadeDuration > 0 ? clamp(this._fadeElapsed / this._fadeDuration, 0, 1) : 1;
    return this.weight * (this._fadeFrom + (this._fadeTo - this._fadeFrom) * f);
  }

  // ---- 控制 ---------------------------------------------------------------

  play(): this {
    this._running = true;
    this._finished = false;
    this._loopsDone = 0;
    this._fadeDuration = 0;
    return this;
  }

  /** 从头播放 */
  restart(): this {
    this._time = 0;
    this._direction = 1;
    return this.play();
  }

  stop(): this {
    this._running = false;
    this._time = 0;
    this._direction = 1;
    this._loopsDone = 0;
    return this;
  }

  pause(): this {
    this.paused = true;
    return this;
  }

  resume(): this {
    this.paused = false;
    return this;
  }

  /** 跳转到指定时间并保持运行状态 */
  seek(time: number): this {
    this._time = clamp(time, 0, this.duration);
    return this;
  }

  /** 在 duration 秒内从 0 淡入到当前权重 */
  fadeIn(duration: number): this {
    this._fadeFrom = 0;
    this._fadeTo = 1;
    this._fadeDuration = Math.max(0, duration);
    this._fadeElapsed = 0;
    return this;
  }

  /** 在 duration 秒内淡出到 0；结束后自动停止 */
  fadeOut(duration: number): this {
    this._fadeFrom = 1;
    this._fadeTo = 0;
    this._fadeDuration = Math.max(0, duration);
    this._fadeElapsed = 0;
    return this;
  }

  /** 播放到底/循环结束时的回调（"once" 与有限次循环都会触发） */
  onFinished(callback: () => void): this {
    this._finishedCallbacks.push(callback);
    return this;
  }

  // ---- 推进 ---------------------------------------------------------------

  /**
   * 推进时间并写回轨道值。
   * @param dt 播放时间步长（= 真实 dt × mixer.timeScale × action.timeScale 前的值）
   * @param realDt 真实时间步长（用于淡入淡出，不受 timeScale 影响）
   */
  update(dt: number, realDt = dt): void {
    if (!this._running || !this.enabled) return;

    if (this._fadeDuration > 0) {
      this._fadeElapsed += Math.abs(realDt);
      if (this._fadeElapsed >= this._fadeDuration) this._fadeDuration = 0;
    }
    if (this.paused) return;

    const duration = this.duration;
    if (duration <= 0) {
      this.clip.apply(0, this.effectiveWeight);
      this._finish();
      return;
    }

    this._time += dt * this.timeScale * this._direction;

    if (this.loop === "once") {
      if (this._time >= duration || this._time <= 0) {
        this._time = this.clampWhenFinished ? clamp(this._time, 0, duration) : 0;
        this.clip.apply(this._time, this.effectiveWeight);
        this._finish();
        return;
      }
    } else if (this.loop === "repeat") {
      while (this._time >= duration) {
        this._time -= duration;
        this._loopsDone++;
        if (this._loopsDone >= this.repetitions) {
          this._time = this.clampWhenFinished ? (this._direction > 0 ? duration : 0) : this._time;
          this.clip.apply(this._time, this.effectiveWeight);
          this._finish();
          return;
        }
      }
      while (this._time < 0) {
        this._time += duration;
        this._loopsDone++;
        if (this._loopsDone >= this.repetitions) {
          this._time = this.clampWhenFinished ? 0 : this._time + duration;
          this.clip.apply(this._time, this.effectiveWeight);
          this._finish();
          return;
        }
      }
    } else {
      // ping-pong：到端点反弹
      let guard = 0;
      while ((this._time >= duration || this._time < 0) && guard++ < 1024) {
        if (this._time >= duration) {
          this._time = duration - (this._time - duration);
          this._direction = -1;
        } else {
          this._time = -this._time;
          this._direction = 1;
        }
        this._loopsDone++;
        if (this._loopsDone >= this.repetitions) {
          this._time = clamp(this._time, 0, duration);
          this.clip.apply(this._time, this.effectiveWeight);
          this._finish();
          return;
        }
      }
    }

    this.clip.apply(this._time, this.effectiveWeight);
  }

  private _finish(): void {
    this._running = false;
    this._finished = true;
    for (let i = 0; i < this._finishedCallbacks.length; i++) this._finishedCallbacks[i]!();
  }
}
