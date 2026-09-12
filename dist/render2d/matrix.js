/**
 * 2D 仿射变换（2x3，与 Canvas2D 语义一致）。
 *
 * 变换矩阵 [a b c d e f] 表示：
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 * 组合方式：CTM = CTM · T（先应用新变换再到当前变换）。
 */
export function identityAffine() {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}
export function copyAffine(m) {
    return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
}
export function multiplyAffine(m, t, out) {
    const a = m.a * t.a + m.c * t.b;
    const b = m.b * t.a + m.d * t.b;
    const c = m.a * t.c + m.c * t.d;
    const d = m.b * t.c + m.d * t.d;
    const e = m.a * t.e + m.c * t.f + m.e;
    const f = m.b * t.e + m.d * t.f + m.f;
    out.a = a;
    out.b = b;
    out.c = c;
    out.d = d;
    out.e = e;
    out.f = f;
    return out;
}
export function transformPoint(m, x, y, out) {
    const px = m.a * x + m.c * y + m.e;
    const py = m.b * x + m.d * y + m.f;
    out.x = px;
    out.y = py;
    return out;
}
/** 把屏幕矩形逆变换到用户空间（供裁剪相交使用，仅无旋转/缩放时精确） */
export function untransformRect(m, x, y, w, h) {
    const det = m.a * m.d - m.b * m.c;
    if (Math.abs(det) < 1e-12)
        return { x: 0, y: 0, w: 0, h: 0 };
    const ia = m.d / det;
    const ib = -m.b / det;
    const ic = -m.c / det;
    const id = m.a / det;
    // 平移分量：p' = p·M + (e,f) → p = (p' - (e,f))·M^-1
    const aX = ia * x + ic * y - (ia * m.e + ic * m.f);
    const aY = ib * x + id * y - (ib * m.e + id * m.f);
    const bX = ia * (x + w) + ic * (y + h) - (ia * m.e + ic * m.f);
    const bY = ib * (x + w) + id * (y + h) - (ib * m.e + id * m.f);
    return { x: Math.min(aX, bX), y: Math.min(aY, bY), w: Math.abs(bX - aX), h: Math.abs(bY - aY) };
}
//# sourceMappingURL=matrix.js.map