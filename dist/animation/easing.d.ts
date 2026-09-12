/**
 * 缓动函数集合（动画/补间通用）。
 *
 * 约定：入参 t ∈ [0,1]，返回 [0,1]（back/elastic 允许短暂越界，用于“回弹”手感）。
 * 所有函数都无副作用、可安全复用于轨道插值与 Tween。
 */
export type EasingFunction = (t: number) => number;
export declare const Easing: {
    readonly linear: EasingFunction;
    /** 平滑起步/收尾（等价 cubic in-out，最常用的“自然”手感） */
    readonly smooth: EasingFunction;
    readonly quadIn: EasingFunction;
    readonly quadOut: EasingFunction;
    readonly quadInOut: EasingFunction;
    readonly cubicIn: EasingFunction;
    readonly cubicOut: EasingFunction;
    readonly cubicInOut: EasingFunction;
    readonly quartIn: EasingFunction;
    readonly quartOut: EasingFunction;
    readonly quartInOut: EasingFunction;
    readonly sineIn: EasingFunction;
    readonly sineOut: EasingFunction;
    readonly sineInOut: EasingFunction;
    readonly expoIn: EasingFunction;
    readonly expoOut: EasingFunction;
    readonly expoInOut: EasingFunction;
    readonly backIn: EasingFunction;
    readonly backOut: EasingFunction;
    readonly backInOut: EasingFunction;
    readonly elasticOut: EasingFunction;
    /** 阶跃：t < 1 时为 0，t >= 1 时为 1（配合“step 插值”使用） */
    readonly step: EasingFunction;
};
export type EasingName = keyof typeof Easing;
/** 名称或函数 → 缓动函数（缺省 linear）。 */
export declare function resolveEasing(easing?: EasingName | EasingFunction): EasingFunction;
//# sourceMappingURL=easing.d.ts.map