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
import { resolveEasing } from "./easing.js";
let nextTrackId = 1;
export class KeyframeTrack {
    id = nextTrackId++;
    name;
    keys;
    type;
    /** 末帧时间（秒）；空轨道为 0 */
    duration;
    _write;
    _after;
    _scratch;
    _blend;
    _prev;
    _hasPrev = false;
    /** 顺序播放时的段游标缓存（避免每次二分） */
    _cursor = 0;
    constructor(options) {
        if (options.keys.length === 0)
            throw new Error("[unidraw] KeyframeTrack 至少需要一个关键帧");
        this.name = options.name ?? `track-${this.id}`;
        this.keys = [...options.keys].sort((a, b) => a.time - b.time);
        this.type = options.type;
        this._write = options.write;
        this._after = options.after;
        this.duration = this.keys[this.keys.length - 1].time;
        const first = this.keys[0].value;
        this._scratch = this.type.create(first);
        this._blend = this.type.create(first);
        this._prev = this.type.create(first);
    }
    /** 采样（不写回）。`out` 可选；对象类型建议复用同一 out 以避免分配。 */
    sample(time, out) {
        const keys = this.keys;
        const target = out ?? this._scratch;
        const last = keys.length - 1;
        if (time <= keys[0].time)
            return this.type.copy(target, keys[0].value);
        if (time >= keys[last].time)
            return this.type.copy(target, keys[last].value);
        // 顺序播放时游标通常只需 +1；否则退化为向前扫描（关键帧数量级很小）
        let i = this._cursor;
        if (i >= last)
            i = 0;
        while (i < last && keys[i + 1].time <= time)
            i++;
        while (i > 0 && keys[i].time > time)
            i--;
        this._cursor = i;
        const k0 = keys[i];
        const k1 = keys[i + 1];
        const span = k1.time - k0.time;
        const raw = span > 1e-9 ? (time - k0.time) / span : 1;
        if (k0.interpolation === "step") {
            return raw >= 1 ? this.type.copy(target, k1.value) : this.type.copy(target, k0.value);
        }
        const eased = resolveEasing(k0.easing)(raw);
        return this.type.lerp(k0.value, k1.value, eased, target);
    }
    /**
     * 求值并写回目标。
     * @param time 轨道本地时间（秒）
     * @param weight 权重（0..1）：< 1 时与上一次写回的值混合（用于淡入淡出/叠加）
     */
    apply(time, weight = 1) {
        const sampled = this.sample(time, this._scratch);
        if (weight >= 1) {
            this._write(sampled);
            this.type.copy(this._prev, sampled);
        }
        else {
            const w = Math.max(0, weight);
            const blended = this.type.lerp(this._prev, sampled, w, this._blend);
            this._write(blended);
            this.type.copy(this._prev, blended);
        }
        this._hasPrev = true;
        this._after?.();
    }
    /** 是否已经有过写回（`apply` 至少调用过一次） */
    get hasApplied() {
        return this._hasPrev;
    }
    /** 便捷：取首个关键帧的值（克隆） */
    firstValue() {
        return this.type.create(this.keys[0].value);
    }
    /** 便捷：取末个关键帧的值（克隆） */
    lastValue() {
        return this.type.create(this.keys[this.keys.length - 1].value);
    }
}
//# sourceMappingURL=KeyframeTrack.js.map