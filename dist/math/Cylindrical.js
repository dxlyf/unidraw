import { equals as numEquals } from "./mmath.js";
import { Vec3 } from "./vec3.js";
/**
 * 柱坐标（Cylindrical）：用「到 +Y 轴的距离 + 绕 +Y 的方位角 + 高度」描述空间点，
 * 与 three.js 的 Cylindrical 约定一致，适合环形排布、螺旋线、极坐标式布局。
 *
 * 坐标约定（右手系，+Y 向上）：
 *   x = radius * sin(theta)
 *   y = y
 *   z = radius * cos(theta)
 * 其中 radius ≥ 0 为到 Y 轴的距离；theta 为绕 +Y 轴的方位角，0 指向 +Z，
 * 向 +X 方向增大；y 为沿 Y 轴的坐标。
 *
 * 这里刻意不做 theta 归一化：任意实数都能被 sin/cos 正确解释，
 * 强行取模会破坏「累加角度」这类用法（如 theta += 速度 * dt）的连续性。
 *
 * 实例方法就地修改并返回 this，便于链式调用；需要保留原值请先 clone()。
 */
export class Cylindrical {
    radius;
    theta;
    y;
    isCylindrical = true;
    constructor(radius = 1, theta = 0, y = 0) {
        this.radius = radius;
        this.theta = theta;
        this.y = y;
    }
    set(radius, theta, y) {
        this.radius = radius;
        this.theta = theta;
        this.y = y;
        return this;
    }
    /** 复制另一个柱坐标的分量（不是替换引用），返回 this。 */
    copy(other) {
        this.radius = other.radius;
        this.theta = other.theta;
        this.y = other.y;
        return this;
    }
    clone() {
        return new Cylindrical(this.radius, this.theta, this.y);
    }
    /**
     * 由直角坐标填充。
     *
     * 为什么用 atan2(x, z)：它在 x = z = 0（点落在 Y 轴上、方位角本无定义）时
     * 仍返回确定的 0，而 asin/acos 形式会得到 NaN 并污染后续计算。
     */
    setFromCartesianCoords(x, y, z) {
        this.radius = Math.sqrt(x * x + z * z);
        this.theta = Math.atan2(x, z);
        this.y = y;
        return this;
    }
    setFromVector3(v) {
        return this.setFromCartesianCoords(v.x, v.y, v.z);
    }
    /**
     * 反算回直角坐标。
     * target 省略时新建 Vec3；在热路径上传入可复用的实例以避免每帧分配。
     */
    toVector3(target = new Vec3()) {
        return target.set(this.radius * Math.sin(this.theta), this.y, this.radius * Math.cos(this.theta));
    }
    equals(other, epsilon) {
        return numEquals(this.radius, other.radius, epsilon) && numEquals(this.theta, other.theta, epsilon) && numEquals(this.y, other.y, epsilon);
    }
    toString() {
        return `Cylindrical(radius=${this.radius.toFixed(3)}, theta=${this.theta.toFixed(3)}, y=${this.y.toFixed(3)})`;
    }
}
//# sourceMappingURL=Cylindrical.js.map