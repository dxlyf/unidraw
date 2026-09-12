import { clamp, equals as numEquals } from "./mmath.js";
import { Vec2 } from "./vec2.js";

/** 模块级临时量：包围盒操作在每帧热路径上，避免反复分配 */
const _vector = new Vec2();

/** 逐分量取小（本仓库 Vec2 未提供 min 实例方法） */
function minComponents(target: Vec2, v: Vec2): void {
  target.x = Math.min(target.x, v.x);
  target.y = Math.min(target.y, v.y);
}

/** 逐分量取大 */
function maxComponents(target: Vec2, v: Vec2): void {
  target.x = Math.max(target.x, v.x);
  target.y = Math.max(target.y, v.y);
}

/**
 * Box2 —— 二维轴对齐包围盒（AABB），用于屏幕空间裁剪、UI/纹理区域等。
 *
 * 空盒约定与 Box3 一致：`min = +∞`、`max = -∞`，于是 `expandByPoint` 无需特判即可从空开始扩张，
 * `isEmpty()` 等价于「某个轴上 max < min」。
 *
 * 实现约定：**只按 x/y 分量读写**自身角点与调用方传入的 target，不调用 target 上的 Vec2 方法。
 * 为什么：二维盒常与普通 `{ x, y }` 对象互操作（鼠标事件、DOM 坐标、类型被擦除的字面量），
 * 只依赖分量既兼容这类对象，也天然避免了 `target === point/min/max` 时的读写冲突。
 */
export class Box2 {
  readonly isBox2 = true;

  min: Vec2;
  max: Vec2;

  constructor(min = new Vec2(+Infinity, +Infinity), max = new Vec2(-Infinity, -Infinity)) {
    this.min = min;
    this.max = max;
  }

  /** 逐分量复制角点（不是持有引用） */
  set(min: Vec2, max: Vec2): this {
    this.min.x = min.x;
    this.min.y = min.y;
    this.max.x = max.x;
    this.max.y = max.y;
    return this;
  }

  makeEmpty(): this {
    this.min.x = +Infinity;
    this.min.y = +Infinity;
    this.max.x = -Infinity;
    this.max.y = -Infinity;
    return this;
  }

  isEmpty(): boolean {
    return this.max.x < this.min.x || this.max.y < this.min.y;
  }

  setFromPoints(points: readonly Vec2[]): this {
    this.makeEmpty();
    for (let i = 0; i < points.length; i++) {
      this.expandByPoint(points[i]!);
    }
    return this;
  }

  setFromCenterAndSize(center: Vec2, size: Vec2): this {
    const halfX = size.x * 0.5;
    const halfY = size.y * 0.5;
    this.min.x = center.x - halfX;
    this.min.y = center.y - halfY;
    this.max.x = center.x + halfX;
    this.max.y = center.y + halfY;
    return this;
  }

  /** 按分量重建，保证结果始终是真正的 Vec2 实例（角点有可能是传入的普通对象） */
  clone(): Box2 {
    return new Box2(new Vec2(this.min.x, this.min.y), new Vec2(this.max.x, this.max.y));
  }

  /** 逐分量复制（不是持有引用） */
  copy(b: Box2): this {
    this.min.x = b.min.x;
    this.min.y = b.min.y;
    this.max.x = b.max.x;
    this.max.y = b.max.y;
    return this;
  }

  /** 空盒没有中心，按 three.js 约定返回原点而不是 NaN */
  getCenter(target: Vec2): Vec2 {
    if (this.isEmpty()) {
      target.x = 0;
      target.y = 0;
    } else {
      target.x = (this.min.x + this.max.x) * 0.5;
      target.y = (this.min.y + this.max.y) * 0.5;
    }
    return target;
  }

  /** 空盒没有尺寸，返回 0 */
  getSize(target: Vec2): Vec2 {
    if (this.isEmpty()) {
      target.x = 0;
      target.y = 0;
    } else {
      target.x = this.max.x - this.min.x;
      target.y = this.max.y - this.min.y;
    }
    return target;
  }

  expandByPoint(p: Vec2): this {
    minComponents(this.min, p);
    maxComponents(this.max, p);
    return this;
  }

  /** 按向量扩张：min 减去 v、max 加上 v（负分量会让该侧内缩） */
  expandByVector(v: Vec2): this {
    this.min.x -= v.x;
    this.min.y -= v.y;
    this.max.x += v.x;
    this.max.y += v.y;
    return this;
  }

  /** 各轴两侧同时外扩 s（s 为负则两侧内缩） */
  expandByScalar(s: number): this {
    this.min.x -= s;
    this.min.y -= s;
    this.max.x += s;
    this.max.y += s;
    return this;
  }

  containsPoint(p: Vec2): boolean {
    return p.x >= this.min.x && p.x <= this.max.x && p.y >= this.min.y && p.y <= this.max.y;
  }

  containsBox(b: Box2): boolean {
    return this.min.x <= b.min.x && b.max.x <= this.max.x && this.min.y <= b.min.y && b.max.y <= this.max.y;
  }

  /** 把盒内点映射到 [0,1]² 参数空间；某轴退化为线段时该轴取 0（避免 0/0） */
  getParameter(point: Vec2, target: Vec2): Vec2 {
    const min = this.min;
    const max = this.max;
    target.x = min.x === max.x ? 0 : clamp((point.x - min.x) / (max.x - min.x), 0, 1);
    target.y = min.y === max.y ? 0 : clamp((point.y - min.y) / (max.y - min.y), 0, 1);
    return target;
  }

  /** 盒内（含边界）距 point 最近的点 */
  clampPoint(point: Vec2, target: Vec2): Vec2 {
    target.x = clamp(point.x, this.min.x, this.max.x);
    target.y = clamp(point.y, this.min.y, this.max.y);
    return target;
  }

  /** 点到盒的距离平方：盒内为 0。先比较平方可省一次开方 */
  distanceToPointSquared(point: Vec2): number {
    const clamped = this.clampPoint(point, _vector);
    const dx = clamped.x - point.x;
    const dy = clamped.y - point.y;
    return dx * dx + dy * dy;
  }

  distanceToPoint(point: Vec2): number {
    return Math.sqrt(this.distanceToPointSquared(point));
  }

  intersectsBox(b: Box2): boolean {
    // 任一轴上分离即不相交
    return !(b.max.x < this.min.x || b.min.x > this.max.x || b.max.y < this.min.y || b.min.y > this.max.y);
  }

  /** 与另一个盒求交（就地把本盒收窄） */
  intersect(b: Box2): this {
    maxComponents(this.min, b.min);
    minComponents(this.max, b.max);
    // 两盒不相交时统一成规范空盒，避免留下 min>max 的交叉值
    if (this.isEmpty()) this.makeEmpty();
    return this;
  }

  /** 与另一个盒求并（就地把本盒扩大） */
  union(b: Box2): this {
    minComponents(this.min, b.min);
    maxComponents(this.max, b.max);
    return this;
  }

  translate(offset: Vec2): this {
    this.min.x += offset.x;
    this.min.y += offset.y;
    this.max.x += offset.x;
    this.max.y += offset.y;
    return this;
  }

  equals(b: Box2, epsilon?: number): boolean {
    return (
      numEquals(this.min.x, b.min.x, epsilon) &&
      numEquals(this.min.y, b.min.y, epsilon) &&
      numEquals(this.max.x, b.max.x, epsilon) &&
      numEquals(this.max.y, b.max.y, epsilon)
    );
  }

  toString(): string {
    return `Box2(min: (${this.min.x}, ${this.min.y}), max: (${this.max.x}, ${this.max.y}))`;
  }
}
