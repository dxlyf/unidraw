import type { Contour } from "./pathTypes.js";
export declare class Path2D {
    private ops;
    private x;
    private y;
    private hasSubpath;
    get empty(): boolean;
    begin(): void;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    /** 相对直线（方便脚本化） */
    rLine(dx: number, dy: number): this;
    quadraticCurveTo(x1: number, y1: number, x: number, y: number): this;
    bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this;
    /** 与 canvas arc 一致：角度为弧度；默认顺时针（y 向下） */
    arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw?: boolean): this;
    arcTo(x1: number, y1: number, x2: number, y2: number, r: number): this;
    ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw?: boolean): this;
    rect(x: number, y: number, w: number, h: number): this;
    /** 圆角矩形；r 可以是数字或 [tl, tr, br, bl] */
    roundRect(x: number, y: number, w: number, h: number, r: number | [number, number, number, number]): this;
    closePath(): this;
    /**
     * 压平为轮廓（填充/描边共用）。
     * @param tolerance 像素容差（决定曲线细分密度）
     */
    flatten(tolerance?: number): Contour[];
    /**
     * arcTo：从当前点 (x0,y0) 到角点 (x1,y1)，以半径 r 与 (x1,y1)-(x2,y2) 相切过渡。
     * 推导：a/b 为角点到前/后点的单位方向；切点距 d=r·cot(δ/2)，
     * 圆心在角平分线（内侧锥）距离 r/sin(δ/2) 处。
     */
    private lineDev;
    /** 自适应细分二次贝塞尔 */
    private flattenQuadTo;
    /** 自适应细分三次贝塞尔（以两控制点 + 中点偏差判平） */
    private flattenCubicTo;
    /**
     * 由容差反推圆弧的最大步进角：弦高 sagitta = R·(1 − cos(θ/2)) ≤ tol。
     *
     * 早期实现用 `max(16, …)` 之类的**固定段数**，半径一大弦高就超容差
     * （半径 22 的圆角只用 2 段 → 弦高约 1.7px，肉眼可见的“折角”）。
     */
    private arcStepCount;
    private arcToPoints;
}
//# sourceMappingURL=Path2D.d.ts.map