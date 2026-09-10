/**
 * 自定义绑定（binding）——把「轨道/Tween 求值出的值」写回具体对象。
 *
 * 轨道本身不认识 Node3D / 材质：所有写回都通过这里的绑定函数完成。
 * 需要驱动自定义对象时，直接写 `(v) => { ... }` 即可（这就是“自定义绑定”）。
 */

import type { Node3D } from "../scene/Node3D.js";
import type { Vec3 } from "../math/vec3.js";
import type { Color } from "../math/color.js";
import { KeyframeTrack, type KeyframeTrackOptions } from "./KeyframeTrack.js";
import { vec3Track, type Vec3Keyframe } from "./Vec3Track.js";
import { colorTrack, type ColorKeyframe } from "./ColorTrack.js";
import { NumberTrackType } from "./NumberTrack.js";

/** 任何提供 setColor(Color) 的对象（内置材质都满足） */
export interface ColorSettable {
  setColor(color: Color): unknown;
}

/** Node3D.position 的写回（经由 setPosition → 正确触发脏标记） */
export function bindNodePosition(node: Node3D): (value: Vec3) => void {
  return (v) => node.setPosition(v.x, v.y, v.z);
}

/** Node3D.rotation（欧拉角，弧度）的写回 */
export function bindNodeRotation(node: Node3D): (value: Vec3) => void {
  return (v) => node.setRotation(v.x, v.y, v.z);
}

/** Node3D.scale 的写回 */
export function bindNodeScale(node: Node3D): (value: Vec3) => void {
  return (v) => node.setScale(v.x, v.y, v.z);
}

/** 材质颜色的写回 */
export function bindObjectColor(target: ColorSettable): (value: Color) => void {
  return (v) => target.setColor(v);
}

/** 标量属性写回：`bindProperty(node.scale, "x")` */
export function bindProperty<T extends object, K extends keyof T>(target: T, key: K): (value: number) => void {
  return (v) => {
    (target[key] as unknown as number) = v;
  };
}

// ---------------------------------------------------------------------------
// 常用轨道的便捷构造
// ---------------------------------------------------------------------------

export function nodePositionTrack(
  node: Node3D,
  keys: readonly Vec3Keyframe[],
  options: Omit<KeyframeTrackOptions<Vec3>, "keys" | "type" | "write"> = {},
): KeyframeTrack<Vec3> {
  return vec3Track(bindNodePosition(node), keys, options);
}

export function nodeRotationTrack(
  node: Node3D,
  keys: readonly Vec3Keyframe[],
  options: Omit<KeyframeTrackOptions<Vec3>, "keys" | "type" | "write"> = {},
): KeyframeTrack<Vec3> {
  return vec3Track(bindNodeRotation(node), keys, options);
}

export function nodeScaleTrack(
  node: Node3D,
  keys: readonly Vec3Keyframe[],
  options: Omit<KeyframeTrackOptions<Vec3>, "keys" | "type" | "write"> = {},
): KeyframeTrack<Vec3> {
  return vec3Track(bindNodeScale(node), keys, options);
}

export function materialColorTrack(
  target: ColorSettable,
  keys: readonly ColorKeyframe[],
  options: Omit<KeyframeTrackOptions<Color>, "keys" | "type" | "write"> = {},
): KeyframeTrack<Color> {
  return colorTrack(bindObjectColor(target), keys, options);
}

/** 标量属性轨道：`propertyTrack(node.scale, "x", keys)` */
export function propertyTrack<T extends object, K extends keyof T>(
  target: T,
  key: K,
  keys: readonly { time: number; value: number; easing?: ColorKeyframe["easing"]; interpolation?: ColorKeyframe["interpolation"] }[],
  options: Omit<KeyframeTrackOptions<number>, "keys" | "type" | "write"> = {},
): KeyframeTrack<number> {
  return new KeyframeTrack<number>({ ...options, keys, type: NumberTrackType, write: bindProperty(target, key) });
}
