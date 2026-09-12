import { Mat4 } from "../math/mat4.js";
import { Vec3 } from "../math/vec3.js";
/**
 * 摄像机：透视投影 + 轨道（orbit）参数。
 * 调用 update()（或直接访问 viewProjection 触发惰性更新）。
 *
 * 轨道约定（`update()` 的推导）：
 * ```
 * eye = center + distance * (cos(pitch)·sin(yaw), sin(pitch), cos(pitch)·cos(yaw))
 * ```
 * - **`pitch > 0` → 相机在目标「上方」（俯视）**；`pitch < 0` → 在下方（仰视）；
 *   想从上方看一个放在 y=0 平面上的场景，pitch 必须取**正值**，
 *   否则相机会钻到地板下面、只能看到地板背面（画面像“什么都没渲染”）。
 * - `yaw > 0` → 相机绕 Y 轴旋转。
 * - 由 `lookAt(eye…)` 反解的 pitch 也符合该约定（`pitch = atan2(centerY-eyeY, 水平距离)`）。
 */
export declare class Camera {
    /** 垂直视场角（弧度），默认 60° */
    fovY: number;
    aspect: number;
    near: number;
    far: number;
    /** 轨道：绕 center 旋转。yaw 绕 Y；**pitch 为正表示相机在目标上方**。 */
    yaw: number;
    pitch: number;
    distance: number;
    center: Vec3;
    private _dirty;
    private _view;
    private _projection;
    private _viewProjection;
    setPerspective(fovYRad: number, aspect: number, near: number, far: number): this;
    /**
     * 用「眼睛位置 + 目标点」设置轨道参数。
     *
     * 与 `update()` 的推导互为逆运算（`lookAt(eye…).update()` 会回到同一个 eye）：
     * 因此从上方看目标时 `pitch` 为**正**。
     */
    lookAt(eyeX: number, eyeY: number, eyeZ: number, centerX?: number, centerY?: number, centerZ?: number): this;
    /** 由轨道参数推导观察矩阵。 */
    update(): void;
    private _eyeX;
    private _eyeY;
    private _eyeZ;
    get view(): Mat4;
    get projection(): Mat4;
    /** viewProjection = projection * view */
    get viewProjection(): Mat4;
    /** 相机世界位置（非分配版本，供渲染器/拾取逐帧调用） */
    getEyePosition(out?: Vec3): Vec3;
    get eyePosition(): Vec3;
}
//# sourceMappingURL=Camera.d.ts.map