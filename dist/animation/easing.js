/**
 * 缓动函数集合（动画/补间通用）。
 *
 * 约定：入参 t ∈ [0,1]，返回 [0,1]（back/elastic 允许短暂越界，用于“回弹”手感）。
 * 所有函数都无副作用、可安全复用于轨道插值与 Tween。
 */
const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * Math.PI) / 3;
/** 幂函数工厂：n=1 线性、2 二次、3 三次… */
function powIn(n) {
    return (t) => Math.pow(t, n);
}
function powOut(n) {
    return (t) => 1 - Math.pow(1 - t, n);
}
function powInOut(n) {
    return (t) => (t < 0.5 ? Math.pow(t * 2, n) / 2 : 1 - Math.pow(2 - t * 2, n) / 2);
}
export const Easing = {
    linear: ((t) => t),
    /** 平滑起步/收尾（等价 cubic in-out，最常用的“自然”手感） */
    smooth: ((t) => t * t * (3 - 2 * t)),
    quadIn: powIn(2),
    quadOut: powOut(2),
    quadInOut: powInOut(2),
    cubicIn: powIn(3),
    cubicOut: powOut(3),
    cubicInOut: powInOut(3),
    quartIn: powIn(4),
    quartOut: powOut(4),
    quartInOut: powInOut(4),
    sineIn: ((t) => 1 - Math.cos((t * Math.PI) / 2)),
    sineOut: ((t) => Math.sin((t * Math.PI) / 2)),
    sineInOut: ((t) => -(Math.cos(Math.PI * t) - 1) / 2),
    expoIn: ((t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10))),
    expoOut: ((t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t))),
    expoInOut: ((t) => t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
    backIn: ((t) => c3 * t * t * t - c1 * t * t),
    backOut: ((t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)),
    backInOut: ((t) => t < 0.5
        ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
        : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2),
    elasticOut: ((t) => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1)),
    /** 阶跃：t < 1 时为 0，t >= 1 时为 1（配合“step 插值”使用） */
    step: ((t) => (t >= 1 ? 1 : 0)),
};
/** 名称或函数 → 缓动函数（缺省 linear）。 */
export function resolveEasing(easing) {
    if (!easing)
        return Easing.linear;
    return typeof easing === "function" ? easing : Easing[easing];
}
//# sourceMappingURL=easing.js.map