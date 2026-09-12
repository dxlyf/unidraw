/**
 * AnimationAction —— Mixer 中「一个片段的播放实例」。
 *
 * 负责时间推进（含循环模式/时间缩放/淡入淡出）与写回（委托给 Clip 的轨道）。
 */
import { clamp } from "../math/mmath.js";
export class AnimationAction {
    clip;
    loop;
    repetitions;
    timeScale;
    weight;
    enabled = true;
    paused = false;
    clampWhenFinished;
    _time = 0;
    _direction = 1;
    _loopsDone = 0;
    _running;
    _finished = false;
    _fadeDuration = 0;
    _fadeElapsed = 0;
    _fadeFrom = 1;
    _fadeTo = 1;
    _finishedCallbacks = [];
    constructor(clip, options = {}) {
        this.clip = clip;
        this.loop = options.loop ?? "repeat";
        this.repetitions = options.repetitions ?? Number.POSITIVE_INFINITY;
        this.timeScale = options.timeScale ?? 1;
        this.weight = options.weight ?? 1;
        this.clampWhenFinished = options.clampWhenFinished ?? true;
        this._running = options.autoPlay ?? false;
    }
    // ---- 状态 ---------------------------------------------------------------
    get duration() {
        return this.clip.effectiveDuration;
    }
    /** 当前播放时间（秒） */
    get time() {
        return this._time;
    }
    set time(value) {
        this._time = clamp(value, 0, this.duration);
    }
    /** 归一化进度 0..1 */
    get progress() {
        const d = this.duration;
        return d > 0 ? this._time / d : 1;
    }
    get running() {
        return this._running;
    }
    get finished() {
        return this._finished;
    }
    /** 已完成的循环次数 */
    get loopCount() {
        return this._loopsDone;
    }
    /** 当前播报方向（ping-pong 下会翻转） */
    get direction() {
        return this._direction;
    }
    /** 有效权重（用户权重 × 淡入淡出系数） */
    get effectiveWeight() {
        const f = this._fadeDuration > 0 ? clamp(this._fadeElapsed / this._fadeDuration, 0, 1) : 1;
        return this.weight * (this._fadeFrom + (this._fadeTo - this._fadeFrom) * f);
    }
    // ---- 控制 ---------------------------------------------------------------
    play() {
        this._running = true;
        this._finished = false;
        this._loopsDone = 0;
        this._fadeDuration = 0;
        return this;
    }
    /** 从头播放 */
    restart() {
        this._time = 0;
        this._direction = 1;
        return this.play();
    }
    stop() {
        this._running = false;
        this._time = 0;
        this._direction = 1;
        this._loopsDone = 0;
        return this;
    }
    pause() {
        this.paused = true;
        return this;
    }
    resume() {
        this.paused = false;
        return this;
    }
    /** 跳转到指定时间并保持运行状态 */
    seek(time) {
        this._time = clamp(time, 0, this.duration);
        return this;
    }
    /** 在 duration 秒内从 0 淡入到当前权重 */
    fadeIn(duration) {
        this._fadeFrom = 0;
        this._fadeTo = 1;
        this._fadeDuration = Math.max(0, duration);
        this._fadeElapsed = 0;
        return this;
    }
    /** 在 duration 秒内淡出到 0；结束后自动停止 */
    fadeOut(duration) {
        this._fadeFrom = 1;
        this._fadeTo = 0;
        this._fadeDuration = Math.max(0, duration);
        this._fadeElapsed = 0;
        return this;
    }
    /** 播放到底/循环结束时的回调（"once" 与有限次循环都会触发） */
    onFinished(callback) {
        this._finishedCallbacks.push(callback);
        return this;
    }
    // ---- 推进 ---------------------------------------------------------------
    /**
     * 推进时间并写回轨道值。
     * @param dt 播放时间步长（= 真实 dt × mixer.timeScale × action.timeScale 前的值）
     * @param realDt 真实时间步长（用于淡入淡出，不受 timeScale 影响）
     */
    update(dt, realDt = dt) {
        if (!this._running || !this.enabled)
            return;
        if (this._fadeDuration > 0) {
            this._fadeElapsed += Math.abs(realDt);
            if (this._fadeElapsed >= this._fadeDuration)
                this._fadeDuration = 0;
        }
        if (this.paused)
            return;
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
        }
        else if (this.loop === "repeat") {
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
        }
        else {
            // ping-pong：到端点反弹
            let guard = 0;
            while ((this._time >= duration || this._time < 0) && guard++ < 1024) {
                if (this._time >= duration) {
                    this._time = duration - (this._time - duration);
                    this._direction = -1;
                }
                else {
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
    _finish() {
        this._running = false;
        this._finished = true;
        for (let i = 0; i < this._finishedCallbacks.length; i++)
            this._finishedCallbacks[i]();
    }
}
//# sourceMappingURL=AnimationAction.js.map