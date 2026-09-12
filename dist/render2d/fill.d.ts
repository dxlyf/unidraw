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
import type { Pt2 } from "./matrix.js";
export type FillRule = "nonzero" | "evenodd";
/** 扫描线梯形分解：返回互不重叠的三角形（用户空间） */
export declare function scanlineFill(polys: readonly Pt2[][], rule: FillRule): Pt2[][];
/**
 * 求一个 `fill()` 需要绘制的三角形。
 *
 * - 单轮廓且不自相交：耳切法（三角形最少，性能最好）；
 * - 其余情况（多子路径 / 自相交）：扫描线梯形分解，按 `rule` 精确求填充区域。
 */
export declare function fillTriangles(polys: readonly Pt2[][], rule: FillRule): Pt2[][];
//# sourceMappingURL=fill.d.ts.map