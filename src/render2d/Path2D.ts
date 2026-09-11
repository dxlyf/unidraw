import type { Pt2 } from "./matrix.js";
import type { Contour, PathOp } from "./pathTypes.js";
import { TAU } from "./pathTypes.js";

export class Path2D {
  private ops: PathOp[] = [];
  private x = 0;
  private y = 0;
  private hasSubpath = false;

  get empty(): boolean {
    return this.ops.length === 0;
  }

  begin(): void {
    this.ops = [];
    this.hasSubpath = false;
    this.x = 0;
    this.y = 0;
  }

  moveTo(x: number, y: number): this {
    this.ops.push({ type: "move", x, y });
    this.x = x;
    this.y = y;
    this.hasSubpath = true;
    return this;
  }

  lineTo(x: number, y: number): this {
    if (!this.hasSubpath) this.moveTo(x, y);
    else {
      this.ops.push({ type: "line", x, y });
      this.x = x;
      this.y = y;
    }
    return this;
  }

  /** 相对直线（方便脚本化） */
  rLine(dx: number, dy: number): this {
    return this.lineTo(this.x + dx, this.y + dy);
  }

  quadraticCurveTo(x1: number, y1: number, x: number, y: number): this {
    if (!this.hasSubpath) this.moveTo(x, y);
    else {
      this.ops.push({ type: "quad", x1, y1, x, y });
      this.x = x;
      this.y = y;
    }
    return this;
  }

  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    if (!this.hasSubpath) this.moveTo(x, y);
    else {
      this.ops.push({ type: "cubic", x1, y1, x2, y2, x, y });
      this.x = x;
      this.y = y;
    }
    return this;
  }

  /** 与 canvas arc 一致：角度为弧度；默认顺时针（y 向下） */
  arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw = false): this {
    this.ops.push({ type: "arc", cx, cy, r, a0, a1, ccw });
    const t = ccw ? a0 : a1;
    this.x = cx + r * Math.cos(t);
    this.y = cy + r * Math.sin(t);
    return this;
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): this {
    this.ops.push({ type: "arcTo", x1, y1, x2, y2, r });
    this.x = x2;
    this.y = y2;
    return this;
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false): this {
    this.ops.push({ type: "ellipse", cx, cy, rx, ry, rot, a0, a1, ccw });
    const t = ccw ? a0 : a1;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const px = rx * Math.cos(t);
    const py = ry * Math.sin(t);
    this.x = cx + px * c - py * s;
    this.y = cy + px * s + py * c;
    return this;
  }

  rect(x: number, y: number, w: number, h: number): this {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
    return this;
  }

  /** 圆角矩形；r 可以是数字或 [tl, tr, br, bl] */
  roundRect(x: number, y: number, w: number, h: number, r: number | [number, number, number, number]): this {
    const rr = typeof r === "number" ? [r, r, r, r] : r;
    const radii = rr.map((v) => Math.max(0, Math.min(v, Math.min(w, h) / 2))) as [number, number, number, number];
    const [tl, tr, br, bl] = radii;
    this.moveTo(x + tl, y);
    this.lineTo(x + w - tr, y);
    if (tr > 0) this.arcTo(x + w, y, x + w, y + tr, tr);
    this.lineTo(x + w, y + h - br);
    if (br > 0) this.arcTo(x + w, y + h, x + w - br, y + h, br);
    this.lineTo(x + bl, y + h);
    if (bl > 0) this.arcTo(x, y + h, x, y + h - bl, bl);
    this.lineTo(x, y + tl);
    if (tl > 0) this.arcTo(x, y, x + tl, y, tl);
    this.closePath();
    return this;
  }

  closePath(): this {
    if (this.hasSubpath) {
      this.ops.push({ type: "close" });
      this.hasSubpath = false;
    }
    return this;
  }

  /**
   * 压平为轮廓（填充/描边共用）。
   * @param tolerance 像素容差（决定曲线细分密度）
   */
  flatten(tolerance = 0.25): Contour[] {
    const contours: Contour[] = [];
    let cur: Pt2[] | null = null;
    let startX = 0;
    let startY = 0;
    let px = 0;
    let py = 0;
    const closeCurrent = (closed: boolean) => {
      if (cur && cur.length > 0) contours.push({ points: cur, closed });
      cur = null;
    };
    const ensure = () => {
      if (!cur) {
        cur = [];
        // 尚未 move 时默认从 (0,0)
        px = this.ops.length ? px : 0;
      }
    };
    void startX;
    void startY;

    for (const op of this.ops) {
      switch (op.type) {
        case "move": {
          closeCurrent(false);
          cur = [];
          cur.push([op.x, op.y]);
          startX = px = op.x;
          startY = py = op.y;
          break;
        }
        case "line": {
          ensure();
          cur!.push([op.x, op.y]);
          px = op.x;
          py = op.y;
          break;
        }
        case "quad": {
          ensure();
          this.flattenQuadTo(px, py, op.x1, op.y1, op.x, op.y, tolerance, 0, cur!);
          px = op.x;
          py = op.y;
          break;
        }
        case "cubic": {
          ensure();
          this.flattenCubicTo(px, py, op.x1, op.y1, op.x2, op.y2, op.x, op.y, tolerance, 0, cur!);
          px = op.x;
          py = op.y;
          break;
        }
        case "arc":
        case "ellipse": {
          ensure();
          const rot = op.type === "ellipse" ? op.rot : 0;
          const rx = op.type === "arc" ? op.r : op.rx;
          const ry = op.type === "ellipse" ? op.ry : op.r;
          const a0 = op.a0;
          const a1 = op.a1;
          const ccw = op.ccw;
          let delta = a1 - a0;
          if (!ccw) {
            while (delta < 0) delta += TAU;
          } else {
            while (delta > 0) delta -= TAU;
          }
          const n = this.arcStepCount(delta, Math.max(rx, ry), tolerance);
          const cos = Math.cos(rot);
          const sin = Math.sin(rot);
          for (let i = 1; i <= n; i++) {
            const t = a0 + (delta * i) / n;
            const lx = rx * Math.cos(t);
            const ly = ry * Math.sin(t);
            cur!.push([op.cx + lx * cos - ly * sin, op.cy + lx * sin + ly * cos]);
          }
          const tEnd = ccw ? a0 : a1;
          px = op.cx + rx * Math.cos(tEnd) * cos - ry * Math.sin(tEnd) * sin;
          py = op.cy + rx * Math.cos(tEnd) * sin + ry * Math.sin(tEnd) * cos;
          break;
        }
        case "arcTo": {
          ensure();
          const s = cur!.length;
          const pts = this.arcToPoints(px, py, op.x1, op.y1, op.x2, op.y2, op.r, tolerance);
          for (let i = 0; i < pts.length; i++) cur!.push(pts[i]!);
          if (cur!.length === s) cur!.push([op.x2, op.y2]);
          px = op.x2;
          py = op.y2;
          break;
        }
        case "close": {
          // 闭环语义由 closed 标记表达，不重复追加首点
          if (cur && cur.length > 0) {
            contours.push({ points: cur, closed: true });
            cur = null;
          }
          break;
        }
      }
    }
    closeCurrent(false);
    return contours;
  }

  /**
   * arcTo：从当前点 (x0,y0) 到角点 (x1,y1)，以半径 r 与 (x1,y1)-(x2,y2) 相切过渡。
   * 推导：a/b 为角点到前/后点的单位方向；切点距 d=r·cot(δ/2)，
   * 圆心在角平分线（内侧锥）距离 r/sin(δ/2) 处。
   */
  private lineDev(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return Math.hypot(px - ax, py - ay);
    return Math.abs(dx * (py - ay) - dy * (px - ax)) / len;
  }

  /** 自适应细分二次贝塞尔 */
  private flattenQuadTo(ax: number, ay: number, cx: number, cy: number, bx: number, by: number, tol: number, depth: number, out: Pt2[]): void {
    if (depth > 18 || this.lineDev(ax, ay, bx, by, cx, cy) <= tol) {
      out.push([bx, by]);
      return;
    }
    const mxa = (ax + cx) / 2;
    const mya = (ay + cy) / 2;
    const mxb = (cx + bx) / 2;
    const myb = (cy + by) / 2;
    const mx = (mxa + mxb) / 2;
    const my = (mya + myb) / 2;
    this.flattenQuadTo(ax, ay, mxa, mya, mx, my, tol, depth + 1, out);
    this.flattenQuadTo(mx, my, mxb, myb, bx, by, tol, depth + 1, out);
  }

  /** 自适应细分三次贝塞尔（以两控制点 + 中点偏差判平） */
  private flattenCubicTo(
    ax: number,
    ay: number,
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    bx: number,
    by: number,
    tol: number,
    depth: number,
    out: Pt2[],
  ): void {
    if (depth > 18) {
      out.push([bx, by]);
      return;
    }
    const dev = Math.max(this.lineDev(ax, ay, bx, by, c1x, c1y), this.lineDev(ax, ay, bx, by, c2x, c2y));
    // 额外检查 t=0.5 处相对弦中点的偏移
    const m1x = (ax + c1x) / 2;
    const m1y = (ay + c1y) / 2;
    const m2x = (c1x + c2x) / 2;
    const m2y = (c1y + c2y) / 2;
    const m3x = (c2x + bx) / 2;
    const m3y = (c2y + by) / 2;
    const n1x = (m1x + m2x) / 2;
    const n1y = (m1y + m2y) / 2;
    const n2x = (m2x + m3x) / 2;
    const n2y = (m2y + m3y) / 2;
    const midX = (n1x + n2x) / 2;
    const midY = (n1y + n2y) / 2;
    const devMid = this.lineDev(ax, ay, bx, by, midX, midY);
    if (Math.max(dev, devMid) <= tol) {
      out.push([bx, by]);
      return;
    }
    // 子分：左 (a,c1,m1,m) 右 (m,m2? ) 用 de Casteljau 取 t=.5 的控制点
    this.flattenCubicTo(ax, ay, m1x, m1y, n1x, n1y, midX, midY, tol, depth + 1, out);
    this.flattenCubicTo(midX, midY, n2x, n2y, m3x, m3y, bx, by, tol, depth + 1, out);
  }

  /**
   * 由容差反推圆弧的最大步进角：弦高 sagitta = R·(1 − cos(θ/2)) ≤ tol。
   *
   * 早期实现用 `max(16, …)` 之类的**固定段数**，半径一大弦高就超容差
   * （半径 22 的圆角只用 2 段 → 弦高约 1.7px，肉眼可见的“折角”）。
   */
  private arcStepCount(sweep: number, radius: number, tol: number): number {
    const r = Math.max(1e-6, radius);
    const ratio = Math.max(-1, Math.min(1, 1 - tol / r));
    const maxStep = 2 * Math.acos(ratio);
    // 半径极大时步进角趋近 0（段数 → ∞），加个上限避免病态输入把顶点数炸掉
    return Math.min(2048, Math.max(2, Math.ceil(Math.abs(sweep) / Math.max(1e-4, maxStep))));
  }

  private arcToPoints(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, radius: number, tol: number): Pt2[] {
    const d01 = Math.hypot(x1 - x0, y1 - y0);
    const d12 = Math.hypot(x2 - x1, y2 - y1);
    if (d01 < 1e-9 || d12 < 1e-9 || radius <= 0) return [[x1, y1]];
    const ax = (x0 - x1) / d01;
    const ay = (y0 - y1) / d01;
    const bx = (x2 - x1) / d12;
    const by = (y2 - y1) / d12;
    const dotAB = Math.max(-1, Math.min(1, ax * bx + ay * by));
    const delta = Math.acos(dotAB); // 两腿夹角 (0, π]
    if (delta < 1e-6 || delta > Math.PI - 1e-3) return [[x1, y1]]; // 近似直线
    // 半径超过某条腿的承载能力时收紧
    const maxR = Math.min(d01, d12) * Math.tan(delta / 2);
    const r = Math.min(radius, maxR);
    if (r <= 1e-6) return [[x1, y1]];
    const d = r / Math.tan(delta / 2);
    const t0x = x1 + ax * d;
    const t0y = y1 + ay * d;
    const t1x = x1 + bx * d;
    const t1y = y1 + by * d;
    // 圆心（内锥角平分线方向）
    const bisx = ax + bx;
    const bisy = ay + by;
    const bl = Math.hypot(bisx, bisy);
    if (bl < 1e-9) return [[x1, y1]];
    const cdist = r / Math.sin(delta / 2);
    const cx = x1 + (bisx / bl) * cdist;
    const cy = y1 + (bisy / bl) * cdist;
    const n0x = t0x - cx;
    const n0y = t0y - cy;
    const n1x = t1x - cx;
    const n1y = t1y - cy;
    const a0 = Math.atan2(n0y, n0x);
    // 沿**带符号**夹角扫过短弧（corner 一侧的圆弧）。
    // `full` 的正负号已经编码了正确的扫掠方向，早期实现又乘了一个
    // `dir = cross >= 0 ? 1 : -1`，方向被翻反 → 圆弧朝形状内部鼓出去，
    // 画出来的圆角是「缺角」，和原生 Canvas2D 完全不同。
    const full = Math.atan2(n0x * n1y - n0y * n1x, n0x * n1x + n0y * n1y);
    const n = this.arcStepCount(full, r, tol);
    const out: Pt2[] = [];
    for (let i = 1; i <= n; i++) {
      const t = a0 + (full * i) / n;
      out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    return out;
  }
}
