import { clamp } from "./mmath.js";
import { Vec3, vec3Cross, vec3Dot } from "./vec3.js";
import type { Plane } from "./Plane.js";

/** 模块级临时量：三角形判定多在热路径上调用，避免反复分配 */
const _v0 = new Vec3();
const _v1 = new Vec3();
const _v2 = new Vec3();
const _ab = new Vec3();
const _ac = new Vec3();
const _ap = new Vec3();
const _bp = new Vec3();
const _cp = new Vec3();
const _best = new Vec3();
const _candidate = new Vec3();

/**
 * 点在线段 ab 上的最近点写入 target，返回点到该点的距离平方。
 * 供退化三角形的兜底路径使用（线段最近点总是一维良定义的）。
 */
function closestPointOnSegment(a: Vec3, b: Vec3, point: Vec3, target: Vec3): number {
  _v1.copy(b).sub(a);
  const lengthSq = _v1.lengthSq();
  if (lengthSq <= 1e-24) {
    _v2.copy(a);
  } else {
    // t 钳到 [0,1]：落在端点外时最近点就是端点
    const t = clamp(vec3Dot(_v0.copy(point).sub(a), _v1) / lengthSq, 0, 1);
    _v2.copy(_v1).multiplyScalar(t).add(a);
  }
  const distanceSq = _v2.distanceToSq(point);
  target.copy(_v2);
  return distanceSq;
}

/**
 * Triangle —— 由三个顶点定义的空间三角形（顶点顺序决定法线朝向）。
 *
 * 约定与 three.js 一致：`getNormal` 用 `(c - b) × (a - b)`，右手系下逆时针绕序得到朝外的法线。
 */
export class Triangle {
  readonly isTriangle = true;

  a: Vec3;
  b: Vec3;
  c: Vec3;

  constructor(a = new Vec3(), b = new Vec3(), c = new Vec3()) {
    this.a = a;
    this.b = b;
    this.c = c;
  }

  /** 复制顶点（而非持有引用） */
  set(a: Vec3, b: Vec3, c: Vec3): this {
    this.a.copy(a);
    this.b.copy(b);
    this.c.copy(c);
    return this;
  }

  /** 从顶点数组 + 索引构建（顶点数据被复制，之后修改数组不影响本三角形） */
  setFromPointsAndIndices(points: readonly Vec3[], i0: number, i1: number, i2: number): this {
    this.a.copy(points[i0]!);
    this.b.copy(points[i1]!);
    this.c.copy(points[i2]!);
    return this;
  }

  clone(): Triangle {
    return new Triangle(this.a.clone(), this.b.clone(), this.c.clone());
  }

  copy(t: Triangle): this {
    this.a.copy(t.a);
    this.b.copy(t.b);
    this.c.copy(t.c);
    return this;
  }

  /** 单位法线；三角形退化（面积为零）时返回零向量，而不是 NaN */
  getNormal(target: Vec3): Vec3 {
    _v0.copy(this.c).sub(this.b);
    _v1.copy(this.a).sub(this.b);
    vec3Cross(_v0, _v1, target);
    const lengthSq = target.lengthSq();
    if (lengthSq > 0) return target.multiplyScalar(1 / Math.sqrt(lengthSq));
    return target.set(0, 0, 0);
  }

  /** 三角形所在平面（法线已单位化，因此 Plane.constant 可直接当距离用） */
  getPlane(target: Plane): Plane {
    return target.setFromNormalAndCoplanarPoint(this.getNormal(_v0), this.a);
  }

  /**
   * 点在三角形上的重心坐标 (x, y, z)，分别对应顶点 a、b、c，三者之和为 1。
   *
   * 退化三角形（三点共线或重合）没有良定义的重心坐标，约定返回 (NaN, NaN, NaN)：
   * 与 three.js 的返回约定一致，同时让 `containsPoint` 因 NaN 比较恒假而自然返回 false。
   * 判据用相对量：`dot00 * dot11 - dot01² = |v0|²|v1|²sin²θ`，与两者乘积之比即 sin²θ，
   * 因此不受三角形尺度影响（小三角形不会被误判为退化）。
   */
  getBarycoord(point: Vec3, target: Vec3): Vec3 {
    _v0.copy(this.c).sub(this.a);
    _v1.copy(this.b).sub(this.a);
    _v2.copy(point).sub(this.a);

    const dot00 = vec3Dot(_v0, _v0);
    const dot01 = vec3Dot(_v0, _v1);
    const dot02 = vec3Dot(_v0, _v2);
    const dot11 = vec3Dot(_v1, _v1);
    const dot12 = vec3Dot(_v1, _v2);

    const denom = dot00 * dot11 - dot01 * dot01;
    if (!(denom > 1e-12 * dot00 * dot11)) return target.set(NaN, NaN, NaN);

    const invDenom = 1 / denom;
    const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
    const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
    return target.set(1 - u - v, v, u);
  }

  /** 点是否落在三角形内（含边与顶点）；退化三角形返回 false */
  containsPoint(point: Vec3): boolean {
    this.getBarycoord(point, _v0);
    return _v0.x >= 0 && _v0.y >= 0 && _v0.z >= 0;
  }

  /**
   * 点到三角形的最近点。
   *
   * 判据：把三角形划分为 3 个顶点区、3 条边区与 1 个面内区，
   * 先用各边与 ap 的点积判断点落在哪个区，再在该区内解析求最近点；
   * 只有面内区需要一次三角形面积归一化。
   */
  closestPointToPoint(point: Vec3, target: Vec3): Vec3 {
    const a = this.a;
    const b = this.b;
    const c = this.c;

    _ab.copy(b).sub(a);
    _ac.copy(c).sub(a);
    _ap.copy(point).sub(a);

    // 顶点 A 区
    const d1 = vec3Dot(_ab, _ap);
    const d2 = vec3Dot(_ac, _ap);
    if (d1 <= 0 && d2 <= 0) return target.copy(a);

    // 顶点 B 区
    _bp.copy(point).sub(b);
    const d3 = vec3Dot(_ab, _bp);
    const d4 = vec3Dot(_ac, _bp);
    if (d3 >= 0 && d4 <= d3) return target.copy(b);

    // 边 AB 区
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      _v0.copy(_ab).multiplyScalar(v).add(a);
      return target.copy(_v0);
    }

    // 顶点 C 区
    _cp.copy(point).sub(c);
    const d5 = vec3Dot(_ab, _cp);
    const d6 = vec3Dot(_ac, _cp);
    if (d6 >= 0 && d5 <= d6) return target.copy(c);

    // 边 AC 区
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      _v0.copy(_ac).multiplyScalar(w).add(a);
      return target.copy(_v0);
    }

    // 边 BC 区
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      _v0.copy(c).sub(b).multiplyScalar(w).add(b);
      return target.copy(_v0);
    }

    // 面内区：重心坐标插值。va + vb + vc = |ab × ac|²，
    // 用与边长四次方量级的相对判据识别退化三角形（此时 sin²θ ≈ 0）。
    const denom = va + vb + vc;
    if (!(denom > 1e-12 * _ab.lengthSq() * _ac.lengthSq())) {
      // 退化时重心插值会变成 0/0，退回到三条线段上取最近者（线段最近点始终良定义）
      let bestSq = closestPointOnSegment(a, b, point, _best);
      let distanceSq = closestPointOnSegment(a, c, point, _candidate);
      if (distanceSq < bestSq) {
        bestSq = distanceSq;
        _best.copy(_candidate);
      }
      distanceSq = closestPointOnSegment(b, c, point, _candidate);
      if (distanceSq < bestSq) _best.copy(_candidate);
      return target.copy(_best);
    }

    const invDenom = 1 / denom;
    const v = vb * invDenom;
    const w = vc * invDenom;
    // 先算到临时量再拷贝，兼容 target 与任一顶点共用同一实例的写法
    _v1.copy(a).add(_v2.copy(_ab).multiplyScalar(v)).add(_v0.copy(_ac).multiplyScalar(w));
    return target.copy(_v1);
  }

  equals(t: Triangle, epsilon?: number): boolean {
    return this.a.equals(t.a, epsilon) && this.b.equals(t.b, epsilon) && this.c.equals(t.c, epsilon);
  }

  toString(): string {
    return `Triangle(a: ${this.a.toString()}, b: ${this.b.toString()}, c: ${this.c.toString()})`;
  }
}
