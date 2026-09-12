/**
 * 自定义绑定（binding）——把「轨道/Tween 求值出的值」写回具体对象。
 *
 * 轨道本身不认识 Node3D / 材质：所有写回都通过这里的绑定函数完成。
 * 需要驱动自定义对象时，直接写 `(v) => { ... }` 即可（这就是“自定义绑定”）。
 */
import { KeyframeTrack } from "./KeyframeTrack.js";
import { vec3Track } from "./Vec3Track.js";
import { colorTrack } from "./ColorTrack.js";
import { NumberTrackType } from "./NumberTrack.js";
/** Node3D.position 的写回（经由 setPosition → 正确触发脏标记） */
export function bindNodePosition(node) {
    return (v) => node.setPosition(v.x, v.y, v.z);
}
/** Node3D.rotation（欧拉角，弧度）的写回 */
export function bindNodeRotation(node) {
    return (v) => node.setRotation(v.x, v.y, v.z);
}
/** Node3D.scale 的写回 */
export function bindNodeScale(node) {
    return (v) => node.setScale(v.x, v.y, v.z);
}
/** 材质颜色的写回 */
export function bindObjectColor(target) {
    return (v) => target.setColor(v);
}
/** 标量属性写回：`bindProperty(node.scale, "x")` */
export function bindProperty(target, key) {
    return (v) => {
        target[key] = v;
    };
}
// ---------------------------------------------------------------------------
// 常用轨道的便捷构造
// ---------------------------------------------------------------------------
export function nodePositionTrack(node, keys, options = {}) {
    return vec3Track(bindNodePosition(node), keys, options);
}
export function nodeRotationTrack(node, keys, options = {}) {
    return vec3Track(bindNodeRotation(node), keys, options);
}
export function nodeScaleTrack(node, keys, options = {}) {
    return vec3Track(bindNodeScale(node), keys, options);
}
export function materialColorTrack(target, keys, options = {}) {
    return colorTrack(bindObjectColor(target), keys, options);
}
/** 标量属性轨道：`propertyTrack(node.scale, "x", keys)` */
export function propertyTrack(target, key, keys, options = {}) {
    return new KeyframeTrack({ ...options, keys, type: NumberTrackType, write: bindProperty(target, key) });
}
//# sourceMappingURL=bindings.js.map