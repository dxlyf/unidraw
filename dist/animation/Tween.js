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
import { Easing, resolveEasing } from "./easing.js";
import { NumberTrackType } from "./NumberTrack.js";
import { Vec3TrackType } from "./Vec3Track.js";
import { ColorTrackType } from "./ColorTrack.js";
export class Tween {
    duration;
    delay;
    repeat;
    yoyo;
    easing;
    _from;
    _to;
    _type;
    _write;
    _value;
    _onUpdate;
    _onRepeat;
    _onComplete;
    _time = 0;
    _loop = 0;
    _playing = false;
    _finished = false;
    _reverse = false;
    constructor(options) {
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
    withEasing(easing) {
        this.easing = easing;
        return this;
    }
    withDelay(delay) {
        this.delay = Math.max(0, delay);
        return this;
    }
    withRepeat(repeat) {
        this.repeat = Math.max(0, repeat);
        return this;
    }
    withYoyo(yoyo = true) {
        this.yoyo = yoyo;
        return this;
    }
    onUpdate(cb) {
        this._onUpdate = cb;
        return this;
    }
    onRepeat(cb) {
        this._onRepeat = cb;
        return this;
    }
    onComplete(cb) {
        this._onComplete = cb;
        return this;
    }
    // ---- 状态 ---------------------------------------------------------------
    get playing() {
        return this._playing;
    }
    get finished() {
        return this._finished;
    }
    /** 已完成的循环次数 */
    get loop() {
        return this._loop;
    }
    /** 当前（最近一次写回的）值 */
    get value() {
        return this._value;
    }
    /** 本次循环内的归一化进度 0..1 */
    get progress() {
        if (this.duration <= 0)
            return 1;
        return clamp(this._time / this.duration, 0, 1);
    }
    // ---- 控制 ---------------------------------------------------------------
    play() {
        this._playing = true;
        this._finished = false;
        return this;
    }
    stop() {
        this._playing = false;
        return this;
    }
    reset() {
        this._time = 0;
        this._loop = 0;
        this._reverse = false;
        this._finished = false;
        return this;
    }
    /** 立即跳到指定进度并写回（不改变播放状态） */
    seek(progress) {
        this._time = clamp(progress, 0, 1) * this.duration;
        this._apply();
        return this;
    }
    /**
     * 推进补间。
     * @returns 是否仍在运行（false = 已完成或未播放）
     */
    update(dt) {
        if (!this._playing)
            return false;
        if (this._finished)
            return false;
        if (this.delay > 0) {
            this.delay -= dt;
            if (this.delay > 0)
                return true;
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
            if (this.yoyo)
                this._reverse = !this._reverse;
            this._time = this.duration > 0 ? overshoot : 0;
            if (this.duration === 0)
                break;
        }
        this._apply();
        return true;
    }
    _apply() {
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
export function tweenNumber(from, to, duration, write, options = {}) {
    return new Tween({ from, to, duration, type: NumberTrackType, write, ...options });
}
export function tweenVec3(from, to, duration, write, options = {}) {
    return new Tween({ from: from.clone(), to: to.clone(), duration, type: Vec3TrackType, write, ...options });
}
export function tweenColor(from, to, duration, write, options = {}) {
    return new Tween({ from: from.clone(), to: to.clone(), duration, type: ColorTrackType, write, ...options });
}
/** 常用缓动可直接用字符串名（等价 `withEasing("cubicOut")`） */
export { Easing };
//# sourceMappingURL=Tween.js.map