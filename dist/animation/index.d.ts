/**
 * 动画模块（`src/animation`）。
 *
 * - 关键帧：`KeyframeTrack`（数值 / Vec3 / 颜色 / 自定义绑定）；
 * - 片段与播放：`AnimationClip` + `AnimationMixer` + `AnimationAction`
 *   （播放/暂停/循环模式/时间缩放/淡入淡出）；
 * - 补间：`Tween`（`tweenNumber` / `tweenVec3` / `tweenColor` / `tweenObject`）+ `TweenManager`；
 * - 缓动：`Easing`（linear/quad/cubic/sine/expo/back/elastic/step）。
 *
 * 详见 docs/animation.md。
 */
export * from "./easing.js";
export * from "./KeyframeTrack.js";
export * from "./NumberTrack.js";
export * from "./Vec3Track.js";
export * from "./ColorTrack.js";
export * from "./bindings.js";
export * from "./AnimationClip.js";
export * from "./AnimationAction.js";
export * from "./AnimationMixer.js";
export * from "./Tween.js";
export * from "./tweenObject.js";
export * from "./TweenManager.js";
//# sourceMappingURL=index.d.ts.map