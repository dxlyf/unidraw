/**
 * 标量（number）轨道：位置分量、透明度、自定义参数等。
 */

import { KeyframeTrack, type Keyframe, type KeyframeTrackOptions, type TrackValueType } from "./KeyframeTrack.js";

export const NumberTrackType: TrackValueType<number> = {
  lerp: (a, b, t) => a + (b - a) * t,
  copy: (_out, value) => value,
  create: () => 0,
};

export type NumberKeyframe = Keyframe<number>;

/** 创建标量轨道（`write` 是自定义绑定，例如 `(v) => mesh.setPosition(v, 0, 0)`）。 */
export function numberTrack(
  write: (value: number) => void,
  keys: readonly NumberKeyframe[],
  options: Omit<KeyframeTrackOptions<number>, "keys" | "type" | "write"> = {},
): KeyframeTrack<number> {
  return new KeyframeTrack<number>({ ...options, keys, type: NumberTrackType, write });
}
