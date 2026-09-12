/**
 * KeyframeTrack —— 关键帧轨道（动画的最小单位）。
 *
 * 一条轨道 = 「一串关键帧」+「值类型（如何插值）」+「写回目标（自定义绑定）」。
 * 因此同一套求值逻辑可以驱动任意对象：Node3D 的 TRS、材质的颜色、后处理参数、
 * 甚至外部 DOM/自定义对象（自定义绑定）。
 *
 * 求值规则：
 * - `time <= 首帧时间` → 首帧值；`time >= 末帧时间` → 末帧值（不外推）；
 * - 段内按左侧关键帧的 `easing` / `interpolation` 插值（缺省线性）；
 * - `interpolation: "step"` → 保持左值直到下一帧（用于离散开关）。
 *
 * 零分配：`apply()` 使用内部暂存值，适合每帧调用。
 */
import type { EasingFunction, EasingName } from "./easing.js";
export type InterpolationMode = "linear" | "step";
export interface Keyframe<T> {
    /** 秒 */
    time: number;
    value: T;
    /** 本段（从本帧到下一帧）的缓动曲线（缺省线性） */
    easing?: EasingName | EasingFunction;
    /** 本段插值方式（缺省 linear） */
    interpolation?: InterpolationMode;
}
/**
 * 值类型：描述「如何插值/复制」某个值。
 * - 标量：`lerp` 返回新数字，`copy` 直接返回入参（number 不可变）；
 * - Vec3/Color：就地写入 `out` 并返回 `out`。
 */
export interface TrackValueType<T> {
    lerp(a: T, b: T, t: number, out: T): T;
    copy(out: T, value: T): T;
    /** 新建一个可写入的暂存值 */
    create(value: T): T;
}
export interface KeyframeTrackOptions<T> {
    name?: string;
    keys: readonly Keyframe<T>[];
    type: TrackValueType<T>;
    /** 求值结果写回目标的唯一出口（自定义绑定点） */
    write: (value: T) => void;
    /** 每次写回后调用（例如 Node3D.markDirty()） */
    after?: () => void;
}
export declare class KeyframeTrack<T> {
    readonly id: number;
    readonly name: string;
    readonly keys: Keyframe<T>[];
    readonly type: TrackValueType<T>;
    /** 末帧时间（秒）；空轨道为 0 */
    readonly duration: number;
    private readonly _write;
    private readonly _after;
    private readonly _scratch;
    private readonly _blend;
    private readonly _prev;
    private _hasPrev;
    /** 顺序播放时的段游标缓存（避免每次二分） */
    private _cursor;
    constructor(options: KeyframeTrackOptions<T>);
    /** 采样（不写回）。`out` 可选；对象类型建议复用同一 out 以避免分配。 */
    sample(time: number, out?: T): T;
    /**
     * 求值并写回目标。
     * @param time 轨道本地时间（秒）
     * @param weight 权重（0..1）：< 1 时与上一次写回的值混合（用于淡入淡出/叠加）
     */
    apply(time: number, weight?: number): void;
    /** 是否已经有过写回（`apply` 至少调用过一次） */
    get hasApplied(): boolean;
    /** 便捷：取首个关键帧的值（克隆） */
    firstValue(): T;
    /** 便捷：取末个关键帧的值（克隆） */
    lastValue(): T;
}
//# sourceMappingURL=KeyframeTrack.d.ts.map