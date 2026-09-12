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
import { Color } from "../math/color.js";
import { Vec3 } from "../math/vec3.js";
import { Easing, type EasingFunction, type EasingName } from "./easing.js";
import type { TrackValueType } from "./KeyframeTrack.js";
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
export declare class Tween<T> {
    duration: number;
    delay: number;
    repeat: number;
    yoyo: boolean;
    easing: EasingName | EasingFunction;
    private readonly _from;
    private readonly _to;
    private readonly _type;
    private readonly _write;
    private _value;
    private _onUpdate;
    private _onRepeat;
    private _onComplete;
    private _time;
    private _loop;
    private _playing;
    private _finished;
    private _reverse;
    constructor(options: TweenOptions<T>);
    withEasing(easing: EasingName | EasingFunction): this;
    withDelay(delay: number): this;
    withRepeat(repeat: number): this;
    withYoyo(yoyo?: boolean): this;
    onUpdate(cb: (value: T, progress: number) => void): this;
    onRepeat(cb: (loop: number) => void): this;
    onComplete(cb: () => void): this;
    get playing(): boolean;
    get finished(): boolean;
    /** 已完成的循环次数 */
    get loop(): number;
    /** 当前（最近一次写回的）值 */
    get value(): T;
    /** 本次循环内的归一化进度 0..1 */
    get progress(): number;
    play(): this;
    stop(): this;
    reset(): this;
    /** 立即跳到指定进度并写回（不改变播放状态） */
    seek(progress: number): this;
    /**
     * 推进补间。
     * @returns 是否仍在运行（false = 已完成或未播放）
     */
    update(dt: number): boolean;
    private _apply;
}
export declare function tweenNumber(from: number, to: number, duration: number, write: (value: number) => void, options?: Partial<Omit<TweenOptions<number>, "from" | "to" | "duration" | "type" | "write">>): Tween<number>;
export declare function tweenVec3(from: Vec3, to: Vec3, duration: number, write: (value: Vec3) => void, options?: Partial<Omit<TweenOptions<Vec3>, "from" | "to" | "duration" | "type" | "write">>): Tween<Vec3>;
export declare function tweenColor(from: Color, to: Color, duration: number, write: (value: Color) => void, options?: Partial<Omit<TweenOptions<Color>, "from" | "to" | "duration" | "type" | "write">>): Tween<Color>;
/** 常用缓动可直接用字符串名（等价 `withEasing("cubicOut")`） */
export { Easing };
//# sourceMappingURL=Tween.d.ts.map