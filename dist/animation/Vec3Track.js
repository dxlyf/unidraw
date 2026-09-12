/**
 * Vec3 轨道：位置/旋转（欧拉角）/缩放、自定义向量参数。
 *
 * 注意：写回 Node3D 时请用 `node.setPosition/setRotation/setScale`（或写完调用
 * `node.markDirty()`），否则局部矩阵不会被标记为脏。
 */
import { Vec3 } from "../math/vec3.js";
import { KeyframeTrack } from "./KeyframeTrack.js";
export const Vec3TrackType = {
    lerp: (a, b, t, out) => out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t),
    copy: (out, value) => out.copy(value),
    create: (value) => value.clone(),
};
/** 创建 Vec3 轨道。 */
export function vec3Track(write, keys, options = {}) {
    return new KeyframeTrack({ ...options, keys, type: Vec3TrackType, write });
}
/** 便捷：按 [x,y,z] 数组书写关键帧 */
export function vec3Keys(keys) {
    return keys.map((k) => ({ time: k.time, value: new Vec3(k.value[0], k.value[1], k.value[2]), easing: k.easing, interpolation: k.interpolation }));
}
//# sourceMappingURL=Vec3Track.js.map