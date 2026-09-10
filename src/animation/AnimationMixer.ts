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

export class AnimationMixer {
  /** 全局时间缩放（0 = 暂停；负值倒放） */
  timeScale = 1;
  /** 关联的根节点（仅用于调试/后续扩展，可为空） */
  readonly root: Node3D | null;
  readonly actions: AnimationAction[] = [];

  private readonly _byClip = new Map<AnimationClip, AnimationAction>();
  /** 已累计播放时间（秒，按 timeScale 折算前） */
  private _elapsed = 0;

  constructor(root?: Node3D) {
    this.root = root ?? null;
  }

  /** 取（或创建）某个 Clip 的 Action。 */
  clip(clip: AnimationClip, options: AnimationActionOptions = {}): AnimationAction {
    const existing = this._byClip.get(clip);
    if (existing) return existing;
    const action = new AnimationAction(clip, options);
    this._byClip.set(clip, action);
    this.actions.push(action);
    return action;
  }

  /** 取（或创建）并立即播放。 */
  play(clip: AnimationClip, options: AnimationActionOptions = {}): AnimationAction {
    return this.clip(clip, options).restart();
  }

  /** 停止所有动作（时间归零）。 */
  stopAll(): this {
    for (const a of this.actions) a.stop();
    return this;
  }

  /** 暂停/恢复所有动作。 */
  setPaused(paused: boolean): this {
    for (const a of this.actions) (paused ? a.pause() : a.resume());
    return this;
  }

  /** 移除某个 Clip 的 Action。 */
  remove(clip: AnimationClip): boolean {
    const action = this._byClip.get(clip);
    if (!action) return false;
    this._byClip.delete(clip);
    const i = this.actions.indexOf(action);
    if (i >= 0) this.actions.splice(i, 1);
    return true;
  }

  /** 推进所有动作。`dt` 为真实秒数（内部乘 `timeScale`）。 */
  update(dt: number): void {
    const scaled = dt * this.timeScale;
    this._elapsed += dt;
    for (let i = 0; i < this.actions.length; i++) {
      this.actions[i]!.update(scaled, dt);
    }
  }

  /** 是否有动作在运行 */
  get running(): boolean {
    return this.actions.some((a) => a.running && a.enabled);
  }

  /** 累计更新时长（秒，未乘 timeScale） */
  get elapsed(): number {
    return this._elapsed;
  }

  /** 当前运行中的动作名（调试/HUD 用） */
  get activeClipNames(): string[] {
    return this.actions.filter((a) => a.running && a.enabled).map((a) => a.clip.name);
  }

  dispose(): void {
    this.stopAll();
    this.actions.length = 0;
    this._byClip.clear();
  }
}
