import { Mat4 } from "../math/mat4.js";
import { Vec3 } from "../math/vec3.js";
import { degToRad } from "../math/mmath.js";

/**
 * 摄像机：透视投影 + 轨道（orbit）参数。
 * 调用 update()（或直接访问 viewProjection 触发惰性更新）。
 */
export class Camera {
  /** 垂直视场角（弧度），默认 60° */
  fovY = degToRad(60);
  aspect = 1;
  near = 0.1;
  far = 200;

  /** 轨道：绕 center 旋转 */
  yaw = 0;
  pitch = 0;
  distance = 8;
  center = new Vec3(0, 0, 0);

  private _dirty = true;
  private _view = new Mat4();
  private _projection = new Mat4();
  private _viewProjection = new Mat4();

  setPerspective(fovYRad: number, aspect: number, near: number, far: number): this {
    this.fovY = fovYRad;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
    this._dirty = true;
    return this;
  }

  lookAt(eyeX: number, eyeY: number, eyeZ: number, centerX = 0, centerY = 0, centerZ = 0): this {
    const dx = centerX - eyeX;
    const dy = centerY - eyeY;
    const dz = centerZ - eyeZ;
    this.distance = Math.max(1e-4, Math.hypot(dx, dy, dz));
    this.center.set(centerX, centerY, centerZ);
    this.yaw = Math.atan2(dx, dz);
    this.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    this._dirty = true;
    return this;
  }

  /** 由轨道参数推导观察矩阵。 */
  update(): void {
    const cp = Math.cos(this.pitch);
    const eyeX = this.center.x + this.distance * cp * Math.sin(this.yaw);
    const eyeY = this.center.y + this.distance * Math.sin(this.pitch);
    const eyeZ = this.center.z + this.distance * cp * Math.cos(this.yaw);
    this._view = Mat4.lookAt(eyeX, eyeY, eyeZ, this.center.x, this.center.y, this.center.z);
    this._projection = Mat4.perspective(this.fovY, this.aspect, this.near, this.far);
    this._viewProjection = Mat4.multiply(this._projection, this._view);
    this._dirty = false;
  }

  get view(): Mat4 {
    if (this._dirty) this.update();
    return this._view;
  }

  get projection(): Mat4 {
    if (this._dirty) this.update();
    return this._projection;
  }

  /** viewProjection = projection * view */
  get viewProjection(): Mat4 {
    if (this._dirty) this.update();
    return this._viewProjection;
  }

  get eyePosition(): Vec3 {
    this.update();
    const inv = new Mat4().copy(this._view);
    inv.invert();
    return new Vec3(inv.elements[12]!, inv.elements[13]!, inv.elements[14]!);
  }
}
