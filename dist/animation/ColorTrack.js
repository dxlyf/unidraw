/**
 * 颜色轨道：材质颜色、灯光色、UI 主题色等（RGBA 线性插值）。
 */
import { Color } from "../math/color.js";
import { KeyframeTrack } from "./KeyframeTrack.js";
export const ColorTrackType = {
    lerp: (a, b, t, out) => out.set(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, a.a + (b.a - a.a) * t),
    copy: (out, value) => out.copy(value),
    create: (value) => value.clone(),
};
/** 创建颜色轨道。 */
export function colorTrack(write, keys, options = {}) {
    return new KeyframeTrack({ ...options, keys, type: ColorTrackType, write });
}
/** 便捷：按十六进制字符串书写关键帧 */
export function colorKeys(keys) {
    return keys.map((k) => ({
        time: k.time,
        value: typeof k.value === "string" ? new Color().setHex(k.value) : k.value.clone(),
        easing: k.easing,
        interpolation: k.interpolation,
    }));
}
//# sourceMappingURL=ColorTrack.js.map