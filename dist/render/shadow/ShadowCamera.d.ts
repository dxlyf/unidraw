/**
 * ShadowCamera —— 计算阴影贴图用的**光源视投影矩阵**（可复用实例，零分配）。
 *
 * - 方向光：围绕场景包围球做正交拟合（`ortho`），并按纹素在光的右/上轴上取整，
 *   避免相机移动时阴影边缘「爬行」（texel snapping）；
 * - 聚光：从灯位置沿方向做透视投影（正方贴图 → aspect = 1，视场角 = 外锥角）。
 *
 * 约定与框架一致：投影使用 ZO（NDC z ∈ [0,1]），深度比较在着色器里直接比 `clip.z/clip.w`。
 */
import { Mat4 } from "../../math/mat4.js";
import { Vec3 } from "../../math/vec3.js";
export declare class ShadowCamera {
    /** 计算得到的 viewProjection（复用对象） */
    readonly matrix: Mat4;
    private _lastNear;
    private _lastFar;
    private _lastTexelWorld;
    private readonly _eye;
    private readonly _target;
    private readonly _right;
    private readonly _up;
    /** 最近一次拟合得到的光源位置（纹素对齐后的；调试/测试用） */
    get eye(): Readonly<Vec3>;
    /** 最近一次拟合的近平面（调试/调参用；`ShadowRenderer` 用它换算 bias） */
    get lastNear(): number;
    /** 最近一次拟合的远平面 */
    get lastFar(): number;
    /** 最近一次拟合一个纹素覆盖的世界尺寸（仅方向光正交拟合有意义） */
    get lastTexelWorld(): number;
    /**
     * 方向光：正交拟合。
     *
     * @param direction 光的传播方向（世界空间，内部归一化）
     * @param center 场景包围球中心
     * @param radius 场景包围球半径（<= 0 时自动用 1）
     * @param mapSize 贴图边长（用于纹素对齐）
     * @param near 近平面（<= 0 时自动）
     * @param far 远平面（<= 0 时自动取 2*radius*distance 的整数倍）
     * @param distance 光源到中心的距离倍数（>= 1）
     */
    fitDirectional(direction: Vec3, center: Vec3, radius: number, mapSize: number, near?: number, far?: number, distance?: number): Mat4;
    /**
     * 聚光：透视拟合。
     *
     * @param position 灯的世界位置
     * @param direction 光的传播方向（世界空间）
     * @param angle 外锥半角（弧度）
     * @param near 近平面
     * @param far 远平面
     * @param fovScale 视场角放大系数（默认 1.05：把锥体稍微撑大，避免边缘裁掉投影物）
     */
    fitSpot(position: Vec3, direction: Vec3, angle: number, near?: number, far?: number, fovScale?: number): Mat4;
}
//# sourceMappingURL=ShadowCamera.d.ts.map