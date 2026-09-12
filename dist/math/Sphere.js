import { equals as numEquals } from "./mmath.js";
import { Vec3 } from "./vec3.js";
/** 模块级临时量：避免热路径反复分配 */
const _v1 = new Vec3();
/**
 * Sphere —— 包围球，由球心 `center` 与半径 `radius` 定义。
 *
 * 空球约定与 three.js 一致：`radius < 0`（`makeEmpty()` 会把半径置为 -1），
 * 这样 `union` 才有「尚未初始化」的状态可用，而不必再引入一个额外的布尔标志。
 */
export class Sphere {
    isSphere = true;
    center;
    radius;
    constructor(center = new Vec3(), radius = -1) {
        this.center = center;
        this.radius = radius;
    }
    /** 复制球心（而非持有引用） */
    set(center, radius) {
        this.center.copy(center);
        this.radius = radius;
        return this;
    }
    /**
     * 由点集求最小包围球（近似：球心取包围盒中心，半径为最远点距离）。
     *
     * 为什么默认球心用包围盒中心而不是平均值：包围盒中心对离群点更稳健，
     * 且与 `Box3.getBoundingSphere` 的结果一致；需要别的球心时传入 `optionalCenter`。
     */
    setFromPoints(points, optionalCenter) {
        const center = this.center;
        if (optionalCenter !== undefined) {
            center.copy(optionalCenter);
        }
        else if (points.length === 0) {
            center.set(0, 0, 0);
        }
        else {
            // 本仓库 Vec3 没有 min/max 静态方法，这里逐分量求包围盒再取中心
            let minX = +Infinity;
            let minY = +Infinity;
            let minZ = +Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            let maxZ = -Infinity;
            for (let i = 0; i < points.length; i++) {
                const p = points[i];
                if (p.x < minX)
                    minX = p.x;
                if (p.y < minY)
                    minY = p.y;
                if (p.z < minZ)
                    minZ = p.z;
                if (p.x > maxX)
                    maxX = p.x;
                if (p.y > maxY)
                    maxY = p.y;
                if (p.z > maxZ)
                    maxZ = p.z;
            }
            center.set((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
        }
        let maxRadiusSq = 0;
        for (let i = 0; i < points.length; i++) {
            maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSq(points[i]));
        }
        this.radius = Math.sqrt(maxRadiusSq);
        return this;
    }
    clone() {
        return new Sphere(this.center.clone(), this.radius);
    }
    copy(s) {
        this.center.copy(s.center);
        this.radius = s.radius;
        return this;
    }
    isEmpty() {
        return this.radius < 0;
    }
    makeEmpty() {
        this.center.set(0, 0, 0);
        this.radius = -1;
        return this;
    }
    /** 点是否在球内（含表面）。空球不包含任何点 */
    containsPoint(p) {
        if (this.isEmpty())
            return false;
        return this.center.distanceToSq(p) <= this.radius * this.radius;
    }
    /** 点到球面的距离（球内为负，球心处为 -radius） */
    distanceToPoint(p) {
        return this.center.distanceTo(p) - this.radius;
    }
    /** 两球是否相交/包含（球心距 ≤ 半径之和） */
    intersectsSphere(s) {
        const radiusSum = this.radius + s.radius;
        return this.center.distanceToSq(s.center) <= radiusSum * radiusSum;
    }
    /** 球体是否与平面相交（含相切）：球心到平面的距离 ≤ 半径 */
    intersectsPlane(plane) {
        return Math.abs(plane.distanceToPoint(this.center)) <= this.radius;
    }
    /**
     * 球体是否与包围盒相交。
     *
     * 判据：把球心钳到盒上得到最近点，球心到该点的距离 ≤ 半径即相交
     * （球心在盒内时距离为 0，必然相交）。空盒不含任何点，直接返回 false。
     */
    intersectsBox(box) {
        if (box.isEmpty())
            return false;
        box.clampPoint(this.center, _v1);
        return _v1.distanceToSq(this.center) <= this.radius * this.radius;
    }
    /** 用轴对齐包围盒填充 target（球取包围盒的最紧凑 AABB，而非最小体积盒） */
    getBoundingBox(target) {
        if (this.isEmpty()) {
            target.makeEmpty();
            return target;
        }
        const c = this.center;
        const r = this.radius;
        target.min.set(c.x - r, c.y - r, c.z - r);
        target.max.set(c.x + r, c.y + r, c.z + r);
        return target;
    }
    /**
     * 用矩阵变换球体。
     *
     * 为什么半径乘「最长基向量」而不是逐轴缩放：非等比缩放会把球压成椭球，
     * 椭球无法用球表示，只能按最大轴保守放大，保证结果仍然包容原几何体。
     */
    applyMatrix4(m) {
        const e = m.elements;
        const sx = Math.hypot(e[0], e[1], e[2]);
        const sy = Math.hypot(e[4], e[5], e[6]);
        const sz = Math.hypot(e[8], e[9], e[10]);
        this.center.applyMat4(m);
        this.radius *= Math.max(sx, sy, sz);
        return this;
    }
    translate(offset) {
        this.center.add(offset);
        return this;
    }
    /**
     * 合并两个球，结果仍是能包住两者的球（通常不是最小包围球）。
     * 合并球心落在两球心连线上，半径取 (r1 + r2 + d) / 2。
     */
    union(s) {
        if (this.isEmpty())
            return this.copy(s);
        if (s.isEmpty())
            return this;
        const dist = this.center.distanceTo(s.center);
        // 已包含对方时无需改动；被对方包含时直接拷贝
        if (this.radius >= dist + s.radius)
            return this;
        if (s.radius >= dist + this.radius)
            return this.copy(s);
        const radius = (this.radius + s.radius + dist) / 2;
        // 走到这里必有 dist > 0（dist === 0 时上面两个分支之一必成立），不会除零
        _v1.copy(s.center).sub(this.center).multiplyScalar((radius - this.radius) / dist).add(this.center);
        this.center.copy(_v1);
        this.radius = radius;
        return this;
    }
    /** 把点钳到球面上：球内点保持不变，球外点沿球心方向拉回表面；target === point 也安全 */
    clampPoint(point, target) {
        const deltaLengthSq = this.center.distanceToSq(point);
        target.copy(point);
        if (deltaLengthSq > this.radius * this.radius) {
            // 直接就地修改 target（而非先写临时量），避免 point 与 target 共用时的读写冲突
            target.sub(this.center).normalize().multiplyScalar(this.radius).add(this.center);
        }
        return target;
    }
    equals(s, epsilon) {
        return this.center.equals(s.center, epsilon) && numEquals(this.radius, s.radius, epsilon);
    }
    toString() {
        return `Sphere(center: ${this.center.toString()}, radius: ${this.radius.toFixed(3)})`;
    }
}
//# sourceMappingURL=Sphere.js.map