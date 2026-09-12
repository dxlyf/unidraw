import { polygonArea2 } from "./triangulate.js";
// ---------------------------------------------------------------------------
// 内部几何小工具
// ---------------------------------------------------------------------------
export function normalOffset(ax, ay, bx, by, hw) {
    const dx = bx - ax;
    const dy = by - ay;
    const l = Math.hypot(dx, dy);
    if (l < 1e-9)
        return { x: 0, y: 0 };
    return { x: (-dy / l) * hw, y: (dx / l) * hw };
}
export function unitDir(ax, ay, bx, by) {
    const l = Math.hypot(bx - ax, by - ay);
    return l > 1e-9 ? { x: (bx - ax) / l, y: (by - ay) / l } : { x: 1, y: 0 };
}
export function lineIntersect(ax, ay, dx1, dy1, bx, by, dx2, dy2) {
    const denom = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(denom) < 1e-9)
        return null;
    const t = ((bx - ax) * dy2 - (by - ay) * dx2) / denom;
    return { x: ax + dx1 * t, y: ay + dy1 * t };
}
export function intersectRects(a, b) {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : { x: 0, y: 0, w: 0, h: 0 };
}
export function sameClip(a, b) {
    if (a === null || b === null)
        return a === b;
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}
export function detectRectContour(path) {
    const cs = path.flatten(0.5);
    if (cs.length !== 1)
        return null;
    const pts = cs[0].points;
    if (pts.length !== 4)
        return null;
    const [a, b, c, d] = [pts[0], pts[1], pts[2], pts[3]];
    const axis = (p, q) => Math.abs(p[0] - q[0]) < 1e-5 || Math.abs(p[1] - q[1]) < 1e-5;
    if (!axis(a, b) || !axis(b, c) || !axis(c, d) || !axis(d, a))
        return null;
    const x = Math.min(a[0], b[0], c[0], d[0]);
    const y = Math.min(a[1], b[1], c[1], d[1]);
    const x2 = Math.max(a[0], b[0], c[0], d[0]);
    const y2 = Math.max(a[1], b[1], c[1], d[1]);
    const area2 = polygonArea2(pts);
    const bboxArea = (x2 - x) * (y2 - y);
    if (Math.abs(Math.abs(area2) - bboxArea) > 1e-3)
        return null;
    return [x, y, x2 - x, y2 - y];
}
//# sourceMappingURL=geometry2d.js.map