import type { Mat4 } from "./mat4.js";
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
export declare class Line3 {
    start: Vec3;
    end: Vec3;
    readonly isLine3 = true;
    constructor(start?: Vec3, end?: Vec3);
    set(start: Vec3, end: Vec3): this;
    /**
     * 用点集的前两个点作为端点；点不足两个时，缺失的端点保持原值，
     * 这样「只有一个点的线」不会把另一端意外清零。
     */
    setFromPoints(points: Vec3[]): this;
    copy(line: Line3): this;
    clone(): Line3;
    /** 线段中点。target 省略时新建 Vec3。 */
    getCenter(target?: Vec3): Vec3;
    /** 方向向量 end − start（模长即线段长度）。target 省略时新建 Vec3。 */
    delta(target?: Vec3): Vec3;
    distanceSq(): number;
    distance(): number;
    /**
     * 线段上的参数化取点：t = 0 得到 start，t = 1 得到 end，
     * t 超出 [0, 1] 时沿同一直线外延。target 省略时新建 Vec3。
     */
    at(t: number, target?: Vec3): Vec3;
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
    closestPointToPointParameter(point: Vec3, clampToLine?: boolean): number;
    /** 线段（clampToLine = true）或无限长直线（false）上离 point 最近的点。 */
    closestPointToPoint(point: Vec3, clampToLine?: boolean, target?: Vec3): Vec3;
    /**
     * 用 Mat4 变换两个端点（点变换，w = 1 并做透视除法）。
     * 仿射变换下图中的线段仍是线段，所以只变换端点即可，无需采样中间点。
     */
    applyMatrix4(m: Mat4): this;
    equals(line: Line3, epsilon?: number): boolean;
    toString(): string;
}
//# sourceMappingURL=Line3.d.ts.map