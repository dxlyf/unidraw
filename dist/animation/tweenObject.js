/**
 * tweenObject —— 一次性补间对象的多个「数值属性」（无需为每个属性单独建 Tween）。
 *
 * ```ts
 * tweenObject(mesh.scale, { x: 2, y: 2, z: 2 }, 0.6, { easing: "backOut" }).play();
 * ```
 * 注意：直接改 Node3D 的 position/rotation/scale 需要显式 `markDirty()`；
 * 更推荐用 `tweenVec3` + `bindNodePosition(node)`。
 */
import { Tween } from "./Tween.js";
export const NumericPropsType = {
    create: (value) => ({ ...value }),
    copy: (out, value) => {
        for (const key in value)
            out[key] = value[key];
        return out;
    },
    lerp: (a, b, t, out) => {
        for (const key in b) {
            const from = a[key] ?? 0;
            out[key] = from + (b[key] - from) * t;
        }
        return out;
    },
};
export function tweenObject(target, props, duration, options = {}) {
    const from = {};
    const to = {};
    const source = props;
    for (const key in source) {
        const value = source[key];
        if (typeof value !== "number")
            continue;
        const current = target[key];
        from[key] = typeof current === "number" ? current : 0;
        to[key] = value;
    }
    const markDirty = options.markDirty ?? false;
    const write = (value) => {
        for (const key in value) {
            target[key] = value[key];
        }
        if (markDirty && typeof target.markDirty === "function") {
            target.markDirty();
        }
    };
    const { markDirty: _ignored, ...tweenOptions } = options;
    void _ignored;
    return new Tween({ from, to, duration, type: NumericPropsType, write, ...tweenOptions });
}
//# sourceMappingURL=tweenObject.js.map