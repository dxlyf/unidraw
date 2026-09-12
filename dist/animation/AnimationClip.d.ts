/**
 * AnimationClip —— 一组轨道的集合（可被 Mixer 播放）。
 *
 * 时长缺省取「最长轨道的末帧时间」，也可显式指定（例如留出停顿）。
 */
import type { KeyframeTrack } from "./KeyframeTrack.js";
/** Clip 只依赖轨道的「可求值」契约（不关心值类型），因此可以混装不同类型轨道。 */
export interface TrackLike {
    readonly name: string;
    readonly duration: number;
    apply(time: number, weight?: number): void;
}
export interface AnimationClipOptions {
    name?: string;
    /** 显式时长（秒）；缺省按轨道最大末帧时间推导 */
    duration?: number;
}
export declare class AnimationClip {
    readonly name: string;
    readonly duration: number;
    readonly tracks: TrackLike[];
    constructor(name?: string, options?: Omit<AnimationClipOptions, "name">);
    /** 追加轨道（返回 this 便于链式）。 */
    addTrack<T>(track: KeyframeTrack<T>): this;
    addTracks(...tracks: TrackLike[]): this;
    /** 实际时长：显式时长与轨道时长取较大者。 */
    get effectiveDuration(): number;
    /** 在给定时间求值全部轨道并写回目标（Mixer 内部使用）。 */
    apply(time: number, weight?: number): void;
}
//# sourceMappingURL=AnimationClip.d.ts.map