/**
 * tweenObject —— 一次性补间对象的多个「数值属性」（无需为每个属性单独建 Tween）。
 *
 * ```ts
 * tweenObject(mesh.scale, { x: 2, y: 2, z: 2 }, 0.6, { easing: "backOut" }).play();
 * ```
 * 注意：直接改 Node3D 的 position/rotation/scale 需要显式 `markDirty()`；
 * 更推荐用 `tweenVec3` + `bindNodePosition(node)`。
 */
import type { TrackValueType } from "./KeyframeTrack.js";
import { Tween, type TweenOptions } from "./Tween.js";
/** 数值属性包（键即属性名） */
export type NumericProps = Record<string, number>;
/** 只保留 `${T}` 中「值为 number」的属性名（Vec3/自定义对象都能用 `{x: 2}` 这种写法） */
export type NumericKeysOf<T> = {
    [K in keyof T]: T[K] extends number ? K : never;
}[keyof T] & string;
export declare const NumericPropsType: TrackValueType<NumericProps>;
export declare function tweenObject<T extends object>(target: T, props: {
    [K in NumericKeysOf<T>]?: number;
}, duration: number, options?: Partial<Omit<TweenOptions<NumericProps>, "from" | "to" | "duration" | "type" | "write">> & {
    markDirty?: boolean;
}): Tween<NumericProps>;
//# sourceMappingURL=tweenObject.d.ts.map