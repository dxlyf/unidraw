/**
 * 标量（number）轨道：位置分量、透明度、自定义参数等。
 */
import { KeyframeTrack } from "./KeyframeTrack.js";
export const NumberTrackType = {
    lerp: (a, b, t) => a + (b - a) * t,
    copy: (_out, value) => value,
    create: () => 0,
};
/** 创建标量轨道（`write` 是自定义绑定，例如 `(v) => mesh.setPosition(v, 0, 0)`）。 */
export function numberTrack(write, keys, options = {}) {
    return new KeyframeTrack({ ...options, keys, type: NumberTrackType, write });
}
//# sourceMappingURL=NumberTrack.js.map