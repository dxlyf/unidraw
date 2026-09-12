/**
 * 多子路径填充：按 Canvas2D 的填充规则（`nonzero` / `evenodd`）求出**精确的填充区域**，
 * 再拆成互不重叠的三角形交给 GPU。
 *
 * 为什么不能「每个轮廓各自三角化」：
 * - 内环（挖洞）会被当成实心填充 —— 甜甜圈画成实心圆盘；
 * - 重叠的子路径会**覆盖两次** —— 半透明填充在重叠处出现深色缝；
 * - 自相交路径（五角星一笔画）用耳切法会得到错误结果。
 *
 * 做法是经典的**扫描线梯形分解**：
 * 1. 把所有轮廓的边（隐式闭合）收集起来，事件 y 取「所有顶点 y + 所有边交点 y」；
 * 2. 每个水平带内在带中点求所有边的交点（附带方向），按 x 排序；
 * 3. 用填充规则把交点配成「内部区间」（evenodd 奇偶配对；nonzero 累计绕数）；
 * 4. 每个区间沿带的上下边界插值成梯形 → 2 个三角形。
 *
 * 梯形之间天然不重叠（它们就是填充区域本身），因此**任何**多子路径/自相交输入都
 * 既能挖洞又不会二次混合。单轮廓且不自相交时仍走更省的耳切法。
 */
import { triangulateSimplePolygon } from "./triangulate.js";
/** 走扫描线的边数上限：超过就退回「逐轮廓耳切」（避免病态输入 O(n²) 爆炸） */
const MAX_SCANLINE_EDGES = 1024;
/** 水平带的高度小于该值视作退化 */
const EPS_Y = 1e-9;
const EPS_X = 1e-9;
function collectEdges(polys) {
    const edges = [];
    for (const pts of polys) {
        const n = pts.length;
        if (n < 3)
            continue;
        for (let i = 0; i < n; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % n];
            if (Math.abs(a[1] - b[1]) < EPS_Y)
                continue; // 水平边不参与求交
            edges.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1] });
        }
    }
    return edges;
}
function xAt(edge, y) {
    const t = (y - edge.ay) / (edge.by - edge.ay);
    return edge.ax + (edge.bx - edge.ax) * t;
}
/** 两条边是否在带内真正相交（用于把交点 y 也变成事件，避免带内左右次序翻转） */
function crossingY(a, b) {
    const rx = a.bx - a.ax;
    const ry = a.by - a.ay;
    const sx = b.bx - b.ax;
    const sy = b.by - b.ay;
    const denom = rx * sy - ry * sx;
    if (Math.abs(denom) < 1e-12)
        return null; // 平行
    const qpx = b.ax - a.ax;
    const qpy = b.ay - a.ay;
    const t = (qpx * sy - qpy * sx) / denom;
    const u = (qpx * ry - qpy * rx) / denom;
    if (t <= 0 || t >= 1 || u <= 0 || u >= 1)
        return null;
    return a.ay + ry * t;
}
/** 单轮廓是否自相交（不自相交才能安全用耳切法） */
function hasSelfIntersection(pts) {
    const n = pts.length;
    if (n < 4)
        return false;
    const seg = (i, j) => [pts[i][0], pts[i][1], pts[j][0], pts[j][1]];
    const cross = (ox, oy, ax, ay, bx, by) => (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
    for (let i = 0; i < n; i++) {
        const [ax, ay, bx, by] = seg(i, (i + 1) % n);
        for (let j = i + 1; j < n; j++) {
            if (j === i || (j + 1) % n === i || j === (i + 1) % n)
                continue; // 相邻边共享端点
            const [cx, cy, dx, dy] = seg(j, (j + 1) % n);
            const d1 = cross(ax, ay, bx, by, cx, cy);
            const d2 = cross(ax, ay, bx, by, dx, dy);
            const d3 = cross(cx, cy, dx, dy, ax, ay);
            const d4 = cross(cx, cy, dx, dy, bx, by);
            if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)))
                return true;
        }
    }
    return false;
}
/** 扫描线梯形分解：返回互不重叠的三角形（用户空间） */
export function scanlineFill(polys, rule) {
    const edges = collectEdges(polys);
    if (edges.length === 0)
        return [];
    // 事件 y：顶点 + 交点
    const ys = [];
    for (const e of edges) {
        ys.push(e.ay, e.by);
    }
    const edgeCount = edges.length;
    if (edgeCount <= 512) {
        for (let i = 0; i < edgeCount; i++) {
            for (let j = i + 1; j < edgeCount; j++) {
                const y = crossingY(edges[i], edges[j]);
                if (y !== null)
                    ys.push(y);
            }
        }
    }
    ys.sort((a, b) => a - b);
    // 去重
    const bands = [];
    for (const y of ys) {
        if (bands.length === 0 || y - bands[bands.length - 1] > EPS_Y)
            bands.push(y);
    }
    const out = [];
    const hits = [];
    for (let bi = 0; bi + 1 < bands.length; bi++) {
        const y0 = bands[bi];
        const y1 = bands[bi + 1];
        if (y1 - y0 < EPS_Y)
            continue;
        const mid = (y0 + y1) * 0.5;
        hits.length = 0;
        for (const e of edges) {
            const lo = Math.min(e.ay, e.by);
            const hi = Math.max(e.ay, e.by);
            if (mid <= lo || mid >= hi)
                continue;
            hits.push({ x: xAt(e, mid), dir: e.by > e.ay ? 1 : -1, edge: e });
        }
        if (hits.length < 2)
            continue;
        hits.sort((p, q) => p.x - q.x);
        // 按填充规则求内部区间
        const spans = [];
        if (rule === "evenodd") {
            for (let i = 0; i + 1 < hits.length; i += 2)
                spans.push([i, i + 1]);
        }
        else {
            let winding = 0;
            let start = -1;
            for (let i = 0; i < hits.length; i++) {
                const before = winding;
                winding += hits[i].dir;
                if (before === 0 && winding !== 0)
                    start = i;
                else if (before !== 0 && winding === 0 && start >= 0) {
                    spans.push([start, i]);
                    start = -1;
                }
            }
        }
        for (const [li, ri] of spans) {
            const le = hits[li].edge;
            const re = hits[ri].edge;
            const xl0 = xAt(le, y0);
            const xr0 = xAt(re, y0);
            const xl1 = xAt(le, y1);
            const xr1 = xAt(re, y1);
            if (xr0 - xl0 < EPS_X && xr1 - xl1 < EPS_X)
                continue;
            const p00 = [xl0, y0];
            const p10 = [xr0, y0];
            const p11 = [xr1, y1];
            const p01 = [xl1, y1];
            out.push([p00, p10, p11], [p00, p11, p01]);
        }
    }
    return out;
}
/** 逐轮廓耳切（回退路径，可能与相邻轮廓重叠） */
function perContourTriangles(polys) {
    const out = [];
    for (const pts of polys) {
        if (pts.length < 3)
            continue;
        const tris = triangulateSimplePolygon(pts);
        if (!tris)
            continue;
        for (let i = 0; i + 2 < tris.length; i += 3) {
            out.push([pts[tris[i]], pts[tris[i + 1]], pts[tris[i + 2]]]);
        }
    }
    return out;
}
/**
 * 求一个 `fill()` 需要绘制的三角形。
 *
 * - 单轮廓且不自相交：耳切法（三角形最少，性能最好）；
 * - 其余情况（多子路径 / 自相交）：扫描线梯形分解，按 `rule` 精确求填充区域。
 */
export function fillTriangles(polys, rule) {
    if (polys.length === 0)
        return [];
    let total = 0;
    for (const p of polys)
        total += p.length;
    if (polys.length === 1 && !hasSelfIntersection(polys[0])) {
        return perContourTriangles(polys);
    }
    if (total > MAX_SCANLINE_EDGES)
        return perContourTriangles(polys);
    const exact = scanlineFill(polys, rule);
    return exact.length > 0 ? exact : perContourTriangles(polys);
}
//# sourceMappingURL=fill.js.map