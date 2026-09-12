/**
 * AnimationMixer —— 动画播放器：管理若干 AnimationAction 的时间推进。
 *
 * 用法：
 * ```ts
 * const mixer = new AnimationMixer(scene);
 * const walk = mixer.clip(walkClip, { loop: "repeat" });
 * walk.play();
 * // 每帧：
 * mixer.update(dt);
 * ```
 *
 * - `mixer.timeScale` 影响所有动作（慢动作/加速/暂停 = 0）；
 * - 同一个 Clip 只会有一个 Action（`clip()` 复用），需要并行播放请创建多个 Mixer；
 * - 未播放的 Action 不会写回属性，因此被动画驱动的属性会保持最后写入的值。
 */
import type { Node3D } from "../scene/Node3D.js";
import { AnimationAction, type AnimationActionOptions } from "./AnimationAction.js";
import type { AnimationClip } from "./AnimationClip.js";
export declare class AnimationMixer {
    /** 全局时间缩放（0 = 暂停；负值倒放） */
    timeScale: number;
    /** 关联的根节点（仅用于调试/后续扩展，可为空） */
    readonly root: Node3D | null;
    readonly actions: AnimationAction[];
    private readonly _byClip;
    /** 已累计播放时间（秒，按 timeScale 折算前） */
    private _elapsed;
    constructor(root?: Node3D);
    /** 取（或创建）某个 Clip 的 Action。 */
    clip(clip: AnimationClip, options?: AnimationActionOptions): AnimationAction;
    /** 取（或创建）并立即播放。 */
    play(clip: AnimationClip, options?: AnimationActionOptions): AnimationAction;
    /** 停止所有动作（时间归零）。 */
    stopAll(): this;
    /** 暂停/恢复所有动作。 */
    setPaused(paused: boolean): this;
    /** 移除某个 Clip 的 Action。 */
    remove(clip: AnimationClip): boolean;
    /** 推进所有动作。`dt` 为真实秒数（内部乘 `timeScale`）。 */
    update(dt: number): void;
    /** 是否有动作在运行 */
    get running(): boolean;
    /** 累计更新时长（秒，未乘 timeScale） */
    get elapsed(): number;
    /** 当前运行中的动作名（调试/HUD 用） */
    get activeClipNames(): string[];
    dispose(): void;
}
//# sourceMappingURL=AnimationMixer.d.ts.map