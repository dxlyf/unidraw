import { Mat4 } from "./mat4.js";
import { clamp } from "./mmath.js";
import { Vec3 } from "./vec3.js";
import type { Plane } from "./Plane.js";
import type { Sphere } from "./Sphere.js";

/** 模块级临时量：包围盒操作在渲染循环里调用频繁，避免反复分配 */
const _vector = new Vec3();

/** 逐分量取小（本仓库 Vec3 未提供 min 实例方法） */
function minComponents(target: Vec3, v: Vec3): void {
  target.x = Math.min(target.x, v.x);
  target.y = Math.min(target.y, v.y);
  target.z = Math.min(target.z, v.z);
}

/** 逐分量取大 */
function maxComponents(target: Vec3, v: Vec3): void {
  target.x = Math.max(target.x, v.x);
  target.y = Math.max(target.y, v.y);
  target.z = Math.max(target.z, v.z);
}

/**
 * Box3 —— 三维轴对齐包围盒（AABB），与坐标轴对齐因此只需 min / max 两个角点。
 *
 * 空盒约定与 three.js 一致：`min = +∞`、`max = -∞`。
 * 这样 `expandByPoint` 无需任何特判就能「从空开始」逐步扩大，
 * 而 `isEmpty()` 也就等价于「某个轴上 max < min」（+∞ > -∞ 必然成立）。
 */
export class Box3 {
  readonly isBox3 = true;

  min: Vec3;
  max: Vec3;

  constructor(min = new Vec3(+Infinity, +Infinity, +Infinity), max = new Vec3(-Infinity, -Infinity, -Infinity)) {
    this.min = min;
    this.max = max;
  }

  /** 复制角点（而非持有引用） */
  set(min: Vec3, max: Vec3): this {
    this.min.copy(min);
    this.max.copy(max);
    return this;
  }

  /** 从扁平的 [x,y,z, x,y,z, ...] 数据构建；非 3 的整数倍尾部会被忽略 */
  setFromArray(array: ArrayLike<number>): this {
    this.makeEmpty();
    for (let i = 0; i + 2 < array.length; i += 3) {
      _vector.set(array[i]!, array[i + 1]!, array[i + 2]!);
      this.expandByPoint(_vector);
    }
    return this;
  }

  makeEmpty(): this {
    this.min.set(+Infinity, +Infinity, +Infinity);
    this.max.set(-Infinity, -Infinity, -Infinity);
    return this;
  }

  isEmpty(): boolean {
    return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z;
  }

  setFromPoints(points: readonly Vec3[]): this {
    this.makeEmpty();
    for (let i = 0; i < points.length; i++) {
      this.expandByPoint(points[i]!);
    }
    return this;
  }

  setFromCenterAndSize(center: Vec3, size: Vec3): this {
    const halfSize = _vector.copy(size).multiplyScalar(0.5);
    this.min.copy(center).sub(halfSize);
    this.max.copy(center).add(halfSize);
    return this;
  }

  clone(): Box3 {
    return new Box3(this.min.clone(), this.max.clone());
  }

  copy(b: Box3): this {
    this.min.copy(b.min);
    this.max.copy(b.max);
    return this;
  }

  /** 空盒没有中心，按 three.js 约定返回原点而不是 (±∞ 的 NaN) */
  getCenter(target: Vec3): Vec3 {
    if (this.isEmpty()) return target.set(0, 0, 0);
    return target.copy(this.min).add(this.max).multiplyScalar(0.5);
  }

  /** 空盒没有尺寸，返回零向量 */
  getSize(target: Vec3): Vec3 {
    if (this.isEmpty()) return target.set(0, 0, 0);
    return target.copy(this.max).sub(this.min);
  }

  expandByPoint(p: Vec3): this {
    minComponents(this.min, p);
    maxComponents(this.max, p);
    return this;
  }

  /** 按向量扩张：min 减去 v、max 加上 v（因此负分量会「内缩」该侧） */
  expandByVector(v: Vec3): this {
    this.min.sub(v);
    this.max.add(v);
    return this;
  }

  /** 各轴两侧同时外扩 s（s 为负则两侧内缩） */
  expandByScalar(s: number): this {
    this.min.x -= s;
    this.min.y -= s;
    this.min.z -= s;
    this.max.x += s;
    this.max.y += s;
    this.max.z += s;
    return this;
  }

  containsPoint(p: Vec3): boolean {
    return (
      p.x >= this.min.x &&
      p.x <= this.max.x &&
      p.y >= this.min.y &&
      p.y <= this.max.y &&
      p.z >= this.min.z &&
      p.z <= this.max.z
    );
  }

  containsBox(b: Box3): boolean {
    return (
      this.min.x <= b.min.x &&
      b.max.x <= this.max.x &&
      this.min.y <= b.min.y &&
      b.max.y <= this.max.y &&
      this.min.z <= b.min.z &&
      b.max.z <= this.max.z
    );
  }

  /** 把盒内点映射到 [0,1]³ 参数空间；某轴退化为平面时该轴取 0（避免 0/0） */
  getParameter(point: Vec3, target: Vec3): Vec3 {
    const min = this.min;
    const max = this.max;
    target.x = min.x === max.x ? 0 : clamp((point.x - min.x) / (max.x - min.x), 0, 1);
    target.y = min.y === max.y ? 0 : clamp((point.y - min.y) / (max.y - min.y), 0, 1);
    target.z = min.z === max.z ? 0 : clamp((point.z - min.z) / (max.z - min.z), 0, 1);
    return target;
  }

  /** 盒内（含表面）距 point 最近的点 */
  clampPoint(point: Vec3, target: Vec3): Vec3 {
    target.copy(point);
    target.x = clamp(target.x, this.min.x, this.max.x);
    target.y = clamp(target.y, this.min.y, this.max.y);
    target.z = clamp(target.z, this.min.z, this.max.z);
    return target;
  }

  /** 点到盒的距离平方：盒内为 0。先比较平方可省一次开方 */
  distanceToPointSquared(point: Vec3): number {
    this.clampPoint(point, _vector);
    return _vector.distanceToSq(point);
  }

  distanceToPoint(point: Vec3): number {
    return Math.sqrt(this.distanceToPointSquared(point));
  }

  intersectsBox(b: Box3): boolean {
    // 任一轴上分离即不相交；用「不 (分离)」写法可同时覆盖相交与包含
    return !(
      b.max.x < this.min.x ||
      b.min.x > this.max.x ||
      b.max.y < this.min.y ||
      b.min.y > this.max.y ||
      b.max.z < this.min.z ||
      b.min.z > this.max.z
    );
  }

  /**
   * 球体是否与包围盒相交。
   *
   * 判据：把球心钳到盒上得到最近点，球心到该点的距离 ≤ 半径即相交
   * （球心在盒内时距离为 0，必然相交）。空盒不含任何点，直接返回 false。
   */
  intersectsSphere(sphere: Sphere): boolean {
    if (this.isEmpty()) return false;
    this.clampPoint(sphere.center, _vector);
    return _vector.distanceToSq(sphere.center) <= sphere.radius * sphere.radius;
  }

  /**
   * 平面是否与包围盒相交（即平面是否「穿过」盒体，含相切）。
   *
   * 判据：正/负顶点法。取沿法线方向最远与最近的角点，分别求其到平面的有符号距离；
   * 若最远的角点仍在平面负侧（<0）或最近的角点仍在正侧（>0），说明盒体整体位于平面一侧，不相交；
   * 否则两侧都有角点（或相切），判为相交。该判据只做两次点积，无需逐角点遍历。
   */
  intersectsPlane(plane: Plane): boolean {
    if (this.isEmpty()) return false;
    const n = plane.normal;
    const min = this.min;
    const max = this.max;
    // 沿法线最远的角点：法线分量为正取 max，为负取 min（分量为 0 时两侧取值相同，不影响结果）
    const farX = n.x > 0 ? max.x : min.x;
    const farY = n.y > 0 ? max.y : min.y;
    const farZ = n.z > 0 ? max.z : min.z;
    // 沿法线最近的角点（与最远角点在各轴上相反）
    const nearX = n.x > 0 ? min.x : max.x;
    const nearY = n.y > 0 ? min.y : max.y;
    const nearZ = n.z > 0 ? min.z : max.z;
    const farDistance = n.x * farX + n.y * farY + n.z * farZ + plane.constant;
    if (farDistance < 0) return false;
    const nearDistance = n.x * nearX + n.y * nearY + n.z * nearZ + plane.constant;
    if (nearDistance > 0) return false;
    return true;
  }

  /** 用能包住整个盒的球填充 target（球心为盒心，半径为半对角线长） */
  getBoundingSphere(target: Sphere): Sphere {
    if (this.isEmpty()) {
      target.makeEmpty();
      return target;
    }
    this.getCenter(target.center);
    target.radius = this.getSize(_vector).length() * 0.5;
    return target;
  }

  /** 与另一个盒求交（就地把本盒收窄） */
  intersect(b: Box3): this {
    maxComponents(this.min, b.min);
    minComponents(this.max, b.max);
    // 两盒不相交时把结果统一成规范空盒，避免留下 min>max 的交叉值
    if (this.isEmpty()) this.makeEmpty();
    return this;
  }

  /** 与另一个盒求并（就地把本盒扩大） */
  union(b: Box3): this {
    minComponents(this.min, b.min);
    maxComponents(this.max, b.max);
    return this;
  }

  /**
   * 用矩阵变换包围盒。
   *
   * 为什么不用 min/max 直接变换：旋转/斜切后 AABB 的角点不再落在变换后的角上，
   * 因此必须把 8 个角点全部变换后重新求包围（结果是新的 AABB，通常比原盒大）。
   * 空盒没有任何角点，变换后仍是空盒，直接返回。
   */
  applyMatrix4(m: Mat4): this {
    if (this.isEmpty()) return this;
    // 先缓存旧角点，再清空本盒——否则 makeEmpty 会把将要读取的数据抹掉
    const minX = this.min.x;
    const minY = this.min.y;
    const minZ = this.min.z;
    const maxX = this.max.x;
    const maxY = this.max.y;
    const maxZ = this.max.z;
    this.makeEmpty();
    for (let i = 0; i < 8; i++) {
      _vector.set((i & 1) === 0 ? minX : maxX, (i & 2) === 0 ? minY : maxY, (i & 4) === 0 ? minZ : maxZ);
      _vector.applyMat4(m);
      this.expandByPoint(_vector);
    }
    return this;
  }

  translate(offset: Vec3): this {
    this.min.add(offset);
    this.max.add(offset);
    return this;
  }

  equals(b: Box3, epsilon?: number): boolean {
    return this.min.equals(b.min, epsilon) && this.max.equals(b.max, epsilon);
  }

  toString(): string {
    return `Box3(min: ${this.min.toString()}, max: ${this.max.toString()})`;
  }
}
