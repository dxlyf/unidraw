/**
 * 2D 仿射变换（2x3，与 Canvas2D 语义一致）。
 *
 * 变换矩阵 [a b c d e f] 表示：
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 * 组合方式：CTM = CTM · T（先应用新变换再到当前变换）。
 */
export type Pt2 = readonly [number, number];
export interface Affine {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
}
export declare function identityAffine(): Affine;
export declare function copyAffine(m: Affine): Affine;
export declare function multiplyAffine(m: Affine, t: Affine, out: Affine): Affine;
export declare function transformPoint(m: Affine, x: number, y: number, out: {
    x: number;
    y: number;
}): {
    x: number;
    y: number;
};
/** 把屏幕矩形逆变换到用户空间（供裁剪相交使用，仅无旋转/缩放时精确） */
export declare function untransformRect(m: Affine, x: number, y: number, w: number, h: number): {
    x: number;
    y: number;
    w: number;
    h: number;
};
//# sourceMappingURL=matrix.d.ts.map