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
export type NumericKeysOf<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T] & string;

export const NumericPropsType: TrackValueType<NumericProps> = {
  create: (value) => ({ ...value }),
  copy: (out, value) => {
    for (const key in value) out[key] = value[key]!;
    return out;
  },
  lerp: (a, b, t, out) => {
    for (const key in b) {
      const from = a[key] ?? 0;
      out[key] = from + (b[key]! - from) * t;
    }
    return out;
  },
};

export function tweenObject<T extends object>(
  target: T,
  props: { [K in NumericKeysOf<T>]?: number },
  duration: number,
  options: Partial<Omit<TweenOptions<NumericProps>, "from" | "to" | "duration" | "type" | "write">> & { markDirty?: boolean } = {},
): Tween<NumericProps> {
  const from: NumericProps = {};
  const to: NumericProps = {};
  const source = props as Record<string, number | undefined>;
  for (const key in source) {
    const value = source[key];
    if (typeof value !== "number") continue;
    const current = (target as Record<string, unknown>)[key];
    from[key] = typeof current === "number" ? current : 0;
    to[key] = value;
  }
  const markDirty = options.markDirty ?? false;
  const write = (value: NumericProps): void => {
    for (const key in value) {
      (target as Record<string, unknown>)[key] = value[key];
    }
    if (markDirty && typeof (target as { markDirty?: () => void }).markDirty === "function") {
      (target as { markDirty: () => void }).markDirty();
    }
  };
  const { markDirty: _ignored, ...tweenOptions } = options;
  void _ignored;
  return new Tween<NumericProps>({ from, to, duration, type: NumericPropsType, write, ...tweenOptions });
}
