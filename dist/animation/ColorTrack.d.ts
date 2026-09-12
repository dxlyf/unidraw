/**
 * 颜色轨道：材质颜色、灯光色、UI 主题色等（RGBA 线性插值）。
 */
import { Color } from "../math/color.js";
import { KeyframeTrack, type Keyframe, type KeyframeTrackOptions, type TrackValueType } from "./KeyframeTrack.js";
export declare const ColorTrackType: TrackValueType<Color>;
export type ColorKeyframe = Keyframe<Color>;
/** 创建颜色轨道。 */
export declare function colorTrack(write: (value: Color) => void, keys: readonly ColorKeyframe[], options?: Omit<KeyframeTrackOptions<Color>, "keys" | "type" | "write">): KeyframeTrack<Color>;
/** 便捷：按十六进制字符串书写关键帧 */
export declare function colorKeys(keys: readonly {
    time: number;
    value: string | Color;
    easing?: ColorKeyframe["easing"];
    interpolation?: ColorKeyframe["interpolation"];
}[]): ColorKeyframe[];
//# sourceMappingURL=ColorTrack.d.ts.map