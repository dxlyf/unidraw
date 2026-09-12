import { Vec2 } from "./vec2.js";
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
export declare class Box2 {
    readonly isBox2 = true;
    min: Vec2;
    max: Vec2;
    constructor(min?: Vec2, max?: Vec2);
    /** 逐分量复制角点（不是持有引用） */
    set(min: Vec2, max: Vec2): this;
    makeEmpty(): this;
    isEmpty(): boolean;
    setFromPoints(points: readonly Vec2[]): this;
    setFromCenterAndSize(center: Vec2, size: Vec2): this;
    /** 按分量重建，保证结果始终是真正的 Vec2 实例（角点有可能是传入的普通对象） */
    clone(): Box2;
    /** 逐分量复制（不是持有引用） */
    copy(b: Box2): this;
    /** 空盒没有中心，按 three.js 约定返回原点而不是 NaN */
    getCenter(target: Vec2): Vec2;
    /** 空盒没有尺寸，返回 0 */
    getSize(target: Vec2): Vec2;
    expandByPoint(p: Vec2): this;
    /** 按向量扩张：min 减去 v、max 加上 v（负分量会让该侧内缩） */
    expandByVector(v: Vec2): this;
    /** 各轴两侧同时外扩 s（s 为负则两侧内缩） */
    expandByScalar(s: number): this;
    containsPoint(p: Vec2): boolean;
    containsBox(b: Box2): boolean;
    /** 把盒内点映射到 [0,1]² 参数空间；某轴退化为线段时该轴取 0（避免 0/0） */
    getParameter(point: Vec2, target: Vec2): Vec2;
    /** 盒内（含边界）距 point 最近的点 */
    clampPoint(point: Vec2, target: Vec2): Vec2;
    /** 点到盒的距离平方：盒内为 0。先比较平方可省一次开方 */
    distanceToPointSquared(point: Vec2): number;
    distanceToPoint(point: Vec2): number;
    intersectsBox(b: Box2): boolean;
    /** 与另一个盒求交（就地把本盒收窄） */
    intersect(b: Box2): this;
    /** 与另一个盒求并（就地把本盒扩大） */
    union(b: Box2): this;
    translate(offset: Vec2): this;
    equals(b: Box2, epsilon?: number): boolean;
    toString(): string;
}
//# sourceMappingURL=Box2.d.ts.map