import { Mat4 } from "../math/mat4.js";
import { Vec3 } from "../math/vec3.js";
import { degToRad } from "../math/mmath.js";
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
export class Camera {
    /** 垂直视场角（弧度），默认 60° */
    fovY = degToRad(60);
    aspect = 1;
    near = 0.1;
    far = 200;
    /** 轨道：绕 center 旋转。yaw 绕 Y；**pitch 为正表示相机在目标上方**。 */
    yaw = 0;
    pitch = 0;
    distance = 8;
    center = new Vec3(0, 0, 0);
    _dirty = true;
    _view = new Mat4();
    _projection = new Mat4();
    _viewProjection = new Mat4();
    setPerspective(fovYRad, aspect, near, far) {
        this.fovY = fovYRad;
        this.aspect = aspect;
        this.near = near;
        this.far = far;
        this._dirty = true;
        return this;
    }
    /**
     * 用「眼睛位置 + 目标点」设置轨道参数。
     *
     * 与 `update()` 的推导互为逆运算（`lookAt(eye…).update()` 会回到同一个 eye）：
     * 因此从上方看目标时 `pitch` 为**正**。
     */
    lookAt(eyeX, eyeY, eyeZ, centerX = 0, centerY = 0, centerZ = 0) {
        const dx = eyeX - centerX;
        const dy = eyeY - centerY;
        const dz = eyeZ - centerZ;
        const horizontal = Math.hypot(dx, dz);
        this.distance = Math.max(1e-4, Math.hypot(dx, dy, dz));
        this.center.set(centerX, centerY, centerZ);
        this.yaw = Math.atan2(dx, dz);
        this.pitch = Math.atan2(dy, horizontal);
        this._dirty = true;
        return this;
    }
    /** 由轨道参数推导观察矩阵。 */
    update() {
        const cp = Math.cos(this.pitch);
        const eyeX = this.center.x + this.distance * cp * Math.sin(this.yaw);
        const eyeY = this.center.y + this.distance * Math.sin(this.pitch);
        const eyeZ = this.center.z + this.distance * cp * Math.cos(this.yaw);
        this._eyeX = eyeX;
        this._eyeY = eyeY;
        this._eyeZ = eyeZ;
        this._view = Mat4.lookAt(eyeX, eyeY, eyeZ, this.center.x, this.center.y, this.center.z);
        this._projection = Mat4.perspective(this.fovY, this.aspect, this.near, this.far);
        this._viewProjection = Mat4.multiply(this._projection, this._view);
        this._dirty = false;
    }
    _eyeX = 0;
    _eyeY = 0;
    _eyeZ = 1;
    get view() {
        if (this._dirty)
            this.update();
        return this._view;
    }
    get projection() {
        if (this._dirty)
            this.update();
        return this._projection;
    }
    /** viewProjection = projection * view */
    get viewProjection() {
        if (this._dirty)
            this.update();
        return this._viewProjection;
    }
    /** 相机世界位置（非分配版本，供渲染器/拾取逐帧调用） */
    getEyePosition(out = new Vec3()) {
        if (this._dirty)
            this.update();
        return out.set(this._eyeX, this._eyeY, this._eyeZ);
    }
    get eyePosition() {
        return this.getEyePosition();
    }
}
//# sourceMappingURL=Camera.js.map