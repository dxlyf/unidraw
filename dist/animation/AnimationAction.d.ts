/**
 * AnimationAction —— Mixer 中「一个片段的播放实例」。
 *
 * 负责时间推进（含循环模式/时间缩放/淡入淡出）与写回（委托给 Clip 的轨道）。
 */
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
export declare class AnimationAction {
    readonly clip: AnimationClip;
    loop: LoopMode;
    repetitions: number;
    timeScale: number;
    weight: number;
    enabled: boolean;
    paused: boolean;
    clampWhenFinished: boolean;
    private _time;
    private _direction;
    private _loopsDone;
    private _running;
    private _finished;
    private _fadeDuration;
    private _fadeElapsed;
    private _fadeFrom;
    private _fadeTo;
    private readonly _finishedCallbacks;
    constructor(clip: AnimationClip, options?: AnimationActionOptions);
    get duration(): number;
    /** 当前播放时间（秒） */
    get time(): number;
    set time(value: number);
    /** 归一化进度 0..1 */
    get progress(): number;
    get running(): boolean;
    get finished(): boolean;
    /** 已完成的循环次数 */
    get loopCount(): number;
    /** 当前播报方向（ping-pong 下会翻转） */
    get direction(): 1 | -1;
    /** 有效权重（用户权重 × 淡入淡出系数） */
    get effectiveWeight(): number;
    play(): this;
    /** 从头播放 */
    restart(): this;
    stop(): this;
    pause(): this;
    resume(): this;
    /** 跳转到指定时间并保持运行状态 */
    seek(time: number): this;
    /** 在 duration 秒内从 0 淡入到当前权重 */
    fadeIn(duration: number): this;
    /** 在 duration 秒内淡出到 0；结束后自动停止 */
    fadeOut(duration: number): this;
    /** 播放到底/循环结束时的回调（"once" 与有限次循环都会触发） */
    onFinished(callback: () => void): this;
    /**
     * 推进时间并写回轨道值。
     * @param dt 播放时间步长（= 真实 dt × mixer.timeScale × action.timeScale 前的值）
     * @param realDt 真实时间步长（用于淡入淡出，不受 timeScale 影响）
     */
    update(dt: number, realDt?: number): void;
    private _finish;
}
//# sourceMappingURL=AnimationAction.d.ts.map