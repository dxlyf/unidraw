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
import { assert } from "../../util/assert.js";

export class ShadowCamera {
  /** 计算得到的 viewProjection（复用对象） */
  readonly matrix = new Mat4();

  private _lastNear = 0.1;
  private _lastFar = 100;
  private _lastTexelWorld = 0;
  private readonly _eye = new Vec3();
  private readonly _target = new Vec3();
  private readonly _right = new Vec3();
  private readonly _up = new Vec3();

  /** 最近一次拟合得到的光源位置（纹素对齐后的；调试/测试用） */
  get eye(): Readonly<Vec3> {
    return this._eye;
  }

  /** 最近一次拟合的近平面（调试/调参用；`ShadowRenderer` 用它换算 bias） */
  get lastNear(): number {
    return this._lastNear;
  }

  /** 最近一次拟合的远平面 */
  get lastFar(): number {
    return this._lastFar;
  }

  /** 最近一次拟合一个纹素覆盖的世界尺寸（仅方向光正交拟合有意义） */
  get lastTexelWorld(): number {
    return this._lastTexelWorld;
  }

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
  fitDirectional(
    direction: Vec3,
    center: Vec3,
    radius: number,
    mapSize: number,
    near = 0,
    far = 0,
    distance = 1.5,
  ): Mat4 {
    const r = Math.max(radius, 1e-3);
    const len = direction.length() || 1;
    const dx = direction.x / len;
    const dy = direction.y / len;
    const dz = direction.z / len;

    // 光空间基底：right = d × worldUp，up = right × d
    let ux = 0;
    let uy = 1;
    let uz = 0;
    if (Math.abs(dy) > 0.999) {
      // 光几乎垂直向下/向上：换成 Z 轴作参考，避免叉乘退化
      ux = 0;
      uy = 0;
      uz = 1;
    }
    this._right.set(dy * uz - dz * uy, dz * ux - dx * uz, dx * uy - dy * ux);
    const rl = this._right.length() || 1;
    this._right.set(this._right.x / rl, this._right.y / rl, this._right.z / rl);
    this._up.set(
      this._right.y * dz - this._right.z * dy,
      this._right.z * dx - this._right.x * dz,
      this._right.x * dy - this._right.y * dx,
    );

    const dist = Math.max(1, distance) * r;
    this._eye.set(center.x - dx * dist, center.y - dy * dist, center.z - dz * dist);

    // 纹素对齐：把光源位置在 right/up 上取整到纹素的整数倍（2r / mapSize 世界单位/纹素）
    const texelWorld = (2 * r) / Math.max(1, mapSize);
    if (texelWorld > 0) {
      const ox = this._eye.x * this._right.x + this._eye.y * this._right.y + this._eye.z * this._right.z;
      const oy = this._eye.x * this._up.x + this._eye.y * this._up.y + this._eye.z * this._up.z;
      const snapX = Math.round(ox / texelWorld) * texelWorld - ox;
      const snapY = Math.round(oy / texelWorld) * texelWorld - oy;
      this._eye.set(
        this._eye.x + this._right.x * snapX + this._up.x * snapY,
        this._eye.y + this._right.y * snapX + this._up.y * snapY,
        this._eye.z + this._right.z * snapX + this._up.z * snapY,
      );
    }

    this._target.copy(center);
    const view = Mat4.lookAt(
      this._eye.x,
      this._eye.y,
      this._eye.z,
      this._target.x,
      this._target.y,
      this._target.z,
      this._up.x,
      this._up.y,
      this._up.z,
    );
    // 包围球一定落在 [dist - r, dist + r]（沿 -Z 的视图深度）；留 20% 余量，
    // 让正交盒在深度方向也完整包住场景（同时不浪费深度范围）
    const nearPlane = near > 0 ? near : Math.max(1e-3, dist - r * 1.2);
    const farPlane = far > 0 ? far : dist + r * 1.2;
    this._lastNear = nearPlane;
    this._lastFar = Math.max(nearPlane + 1e-3, farPlane);
    this._lastTexelWorld = texelWorld;
    const projection = Mat4.ortho(-r, r, -r, r, nearPlane, this._lastFar);
    return Mat4.multiply(projection, view, this.matrix);
  }

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
  fitSpot(
    position: Vec3,
    direction: Vec3,
    angle: number,
    near = 0.1,
    far = 100,
    fovScale = 1.05,
  ): Mat4 {
    const nearPlane = near > 0 ? near : 0.1;
    assert(far > nearPlane, "聚光阴影的 far 必须大于 near");
    this._lastNear = nearPlane;
    this._lastFar = far;
    this._lastTexelWorld = 0;
    const len = direction.length() || 1;
    const dx = direction.x / len;
    const dy = direction.y / len;
    const dz = direction.z / len;
    const fov = Math.max(1e-3, Math.min(Math.PI * 0.49, angle * 2 * fovScale));
    // 光几乎垂直时换 Z 轴作为 up，避免 lookAt 退化
    const vertical = Math.abs(dy) > 0.999;
    const upX = 0;
    const upY = vertical ? 0 : 1;
    const upZ = vertical ? 1 : 0;
    const view = Mat4.lookAt(position.x, position.y, position.z, position.x + dx, position.y + dy, position.z + dz, upX, upY, upZ);
    const projection = Mat4.perspective(fov, 1, nearPlane, far);
    return Mat4.multiply(projection, view, this.matrix);
  }
}
