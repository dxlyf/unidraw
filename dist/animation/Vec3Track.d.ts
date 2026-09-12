/**
 * Vec3 轨道：位置/旋转（欧拉角）/缩放、自定义向量参数。
 *
 * 注意：写回 Node3D 时请用 `node.setPosition/setRotation/setScale`（或写完调用
 * `node.markDirty()`），否则局部矩阵不会被标记为脏。
 */
import { Vec3 } from "../math/vec3.js";
import { KeyframeTrack, type Keyframe, type KeyframeTrackOptions, type TrackValueType } from "./KeyframeTrack.js";
export declare const Vec3TrackType: TrackValueType<Vec3>;
export type Vec3Keyframe = Keyframe<Vec3>;
/** 创建 Vec3 轨道。 */
export declare function vec3Track(write: (value: Vec3) => void, keys: readonly Vec3Keyframe[], options?: Omit<KeyframeTrackOptions<Vec3>, "keys" | "type" | "write">): KeyframeTrack<Vec3>;
/** 便捷：按 [x,y,z] 数组书写关键帧 */
export declare function vec3Keys(keys: readonly {
    time: number;
    value: [number, number, number];
    easing?: Vec3Keyframe["easing"];
    interpolation?: Vec3Keyframe["interpolation"];
}[]): Vec3Keyframe[];
//# sourceMappingURL=Vec3Track.d.ts.map