import { clamp } from "./mmath.js";
import { Vec3 } from "./vec3.js";
/**
 * 三维线段（Line3）：由两个端点 start / end 定义，端点均为 Vec3。
 *
 * 约定：
 *  - `set()` 复制分量而不是替换引用，避免调用方已经持有的 start/end 引用失效；
 *  - 所有需要返回向量的方法都接受可选的 `target`，省略时新建 Vec3，
 *    热路径上传入可复用实例即可做到零分配；
 *  - 不存储方向/长度缓存：线段是可变对象，缓存只会带来失效管理成本。
 *
 * 实例方法就地修改并返回 this，便于链式调用；需要保留原值请先 clone()。
 */
export class Line3 {
    start;
    end;
    isLine3 = true;
    constructor(start = new Vec3(), end = new Vec3()) {
        this.start = start;
        this.end = end;
    }
    set(start, end) {
        this.start.copy(start);
        this.end.copy(end);
        return this;
    }
    /**
     * 用点集的前两个点作为端点；点不足两个时，缺失的端点保持原值，
     * 这样「只有一个点的线」不会把另一端意外清零。
     */
    setFromPoints(points) {
        const first = points[0];
        const second = points[1];
        if (first)
            this.start.copy(first);
        if (second)
            this.end.copy(second);
        return this;
    }
    copy(line) {
        this.start.copy(line.start);
        this.end.copy(line.end);
        return this;
    }
    clone() {
        return new Line3().copy(this);
    }
    /** 线段中点。target 省略时新建 Vec3。 */
    getCenter(target = new Vec3()) {
        return target.set((this.start.x + this.end.x) * 0.5, (this.start.y + this.end.y) * 0.5, (this.start.z + this.end.z) * 0.5);
    }
    /** 方向向量 end − start（模长即线段长度）。target 省略时新建 Vec3。 */
    delta(target = new Vec3()) {
        return target.set(this.end.x - this.start.x, this.end.y - this.start.y, this.end.z - this.start.z);
    }
    distanceSq() {
        return this.start.distanceToSq(this.end);
    }
    distance() {
        return Math.sqrt(this.distanceSq());
    }
    /**
     * 线段上的参数化取点：t = 0 得到 start，t = 1 得到 end，
     * t 超出 [0, 1] 时沿同一直线外延。target 省略时新建 Vec3。
     */
    at(t, target = new Vec3()) {
        return target.set(this.start.x + (this.end.x - this.start.x) * t, this.start.y + (this.end.y - this.start.y) * t, this.start.z + (this.end.z - this.start.z) * t);
    }
    /**
     * 求 point 在直线上的投影参数 t（点到 start 的有向距离 / 线段长度）。
     *
     * clampToLine = true（默认）把结果夹到 [0, 1]，得到线段上的最近点；
     * 传 false 则得到无限长直线上的投影，可用于判断点在直线哪一侧。
     *
     * 退化处理：start 与 end 重合（或短到浮点无法分辨）时分母为 0，投影参数
     * 本无定义；若不特判会算出 0/0 = NaN 并一路污染距离/交点计算。这里约定返回 0，
     * 即「最近点就是重合的那个端点」。
     */
    closestPointToPointParameter(point, clampToLine = true) {
        const sx = this.start.x;
        const sy = this.start.y;
        const sz = this.start.z;
        const dx = this.end.x - sx;
        const dy = this.end.y - sy;
        const dz = this.end.z - sz;
        const denom = dx * dx + dy * dy + dz * dz;
        if (denom < 1e-18)
            return 0;
        const t = ((point.x - sx) * dx + (point.y - sy) * dy + (point.z - sz) * dz) / denom;
        return clampToLine ? clamp(t, 0, 1) : t;
    }
    /** 线段（clampToLine = true）或无限长直线（false）上离 point 最近的点。 */
    closestPointToPoint(point, clampToLine = true, target = new Vec3()) {
        return this.at(this.closestPointToPointParameter(point, clampToLine), target);
    }
    /**
     * 用 Mat4 变换两个端点（点变换，w = 1 并做透视除法）。
     * 仿射变换下图中的线段仍是线段，所以只变换端点即可，无需采样中间点。
     */
    applyMatrix4(m) {
        this.start.applyMat4(m);
        this.end.applyMat4(m);
        return this;
    }
    equals(line, epsilon) {
        return this.start.equals(line.start, epsilon) && this.end.equals(line.end, epsilon);
    }
    toString() {
        return `Line3(${this.start.toString()} -> ${this.end.toString()})`;
    }
}
//# sourceMappingURL=Line3.js.map