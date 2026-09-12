/**
 * AnimationClip —— 一组轨道的集合（可被 Mixer 播放）。
 *
 * 时长缺省取「最长轨道的末帧时间」，也可显式指定（例如留出停顿）。
 */
export class AnimationClip {
    name;
    duration;
    tracks = [];
    constructor(name = "clip", options = {}) {
        this.name = name;
        this.duration = options.duration ?? 0;
    }
    /** 追加轨道（返回 this 便于链式）。 */
    addTrack(track) {
        this.tracks.push(track);
        return this;
    }
    addTracks(...tracks) {
        this.tracks.push(...tracks);
        return this;
    }
    /** 实际时长：显式时长与轨道时长取较大者。 */
    get effectiveDuration() {
        let max = this.duration;
        for (const t of this.tracks)
            max = Math.max(max, t.duration);
        return max;
    }
    /** 在给定时间求值全部轨道并写回目标（Mixer 内部使用）。 */
    apply(time, weight = 1) {
        for (let i = 0; i < this.tracks.length; i++) {
            this.tracks[i].apply(time, weight);
        }
    }
}
//# sourceMappingURL=AnimationClip.js.map