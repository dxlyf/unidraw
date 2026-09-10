/**
 * 灯光数据的 CPU 打包（std140）—— 与 shader 里的 `LightsBlock` 一一对应。
 *
 * 布局（vec4 粒度，共 38 个 vec4 = 608 字节）：
 * ```
 * u_ambient      vec4              // rgb = 环境光颜色（已乘强度）
 * u_counts       vec4              // x=方向光数 y=点光数 z=聚光数
 * u_dirDir[4]    vec4 × 4          // xyz = 光传播方向（世界空间，已归一化）
 * u_dirColor[4]  vec4 × 4          // rgb = 颜色×强度
 * u_pointPos[8]  vec4 × 8          // xyz = 世界位置, w = 影响距离（0 = 无限）
 * u_pointColor[8]vec4 × 8          // rgb = 颜色×强度, a = decay
 * u_spotPos[4]   vec4 × 4          // xyz = 世界位置, w = 影响距离
 * u_spotDir[4]   vec4 × 4          // xyz = 方向, w = cos(外锥角)
 * u_spotColor[4] vec4 × 4          // rgb = 颜色×强度, a = cos(内锥角)
 * ```
 * 内锥角由 `angle` 与 `penumbra` 预先算成 `cos` 存进 UBO，fragment 里不需要 `acos`。
 */

import { Color } from "../../math/color.js";
import { Vec3 } from "../../math/vec3.js";
import { std140Layout, type UniformField } from "../../gpu/std140.js";

/** 单个着色器里支持的方向光上限 */
export const MAX_DIRECTIONAL_LIGHTS = 4;
/** 点光上限 */
export const MAX_POINT_LIGHTS = 8;
/** 聚光上限 */
export const MAX_SPOT_LIGHTS = 4;

export const LIGHTS_FIELDS: UniformField[] = [
  { name: "u_ambient", type: "vec4" },
  { name: "u_counts", type: "vec4" },
  { name: "u_dirDir", type: "vec4", count: MAX_DIRECTIONAL_LIGHTS },
  { name: "u_dirColor", type: "vec4", count: MAX_DIRECTIONAL_LIGHTS },
  { name: "u_pointPos", type: "vec4", count: MAX_POINT_LIGHTS },
  { name: "u_pointColor", type: "vec4", count: MAX_POINT_LIGHTS },
  { name: "u_spotPos", type: "vec4", count: MAX_SPOT_LIGHTS },
  { name: "u_spotDir", type: "vec4", count: MAX_SPOT_LIGHTS },
  { name: "u_spotColor", type: "vec4", count: MAX_SPOT_LIGHTS },
];

const layout = std140Layout(LIGHTS_FIELDS);
const offsetOf = (name: string): number => {
  const f = layout.byName.get(name);
  if (!f) throw new Error(`[unidraw] LightsBlock 缺少字段 ${name}`);
  return f.offset / 4;
};
const OFFSET = {
  ambient: offsetOf("u_ambient"),
  counts: offsetOf("u_counts"),
  dirDir: offsetOf("u_dirDir"),
  dirColor: offsetOf("u_dirColor"),
  pointPos: offsetOf("u_pointPos"),
  pointColor: offsetOf("u_pointColor"),
  spotPos: offsetOf("u_spotPos"),
  spotDir: offsetOf("u_spotDir"),
  spotColor: offsetOf("u_spotColor"),
};
const STRIDE = 4; // vec4 步长（float 数）

/**
 * 一帧的灯光状态：可复用的打包缓冲（`data` 直接上传到 UBO，零分配）。
 *
 * 用法：`reset()` → 若干 `addAmbient/addDirectional/addPoint/addSpot` → `finish()`。
 * 没有任何灯时用 `fillDefault()` 写入一套默认光，保证「不写灯也有光照」的历史观感。
 */
export class LightsState {
  /** 打包好的 std140 数据（float 数 = 152） */
  readonly data: Float32Array;
  dirCount = 0;
  pointCount = 0;
  spotCount = 0;

  private _ambR = 0;
  private _ambG = 0;
  private _ambB = 0;
  /** 超出上限被忽略的灯数量（用于提示/自检） */
  overflow = 0;

  constructor() {
    this.data = new Float32Array(layout.size / 4);
  }

  reset(): this {
    this.data.fill(0);
    this.dirCount = 0;
    this.pointCount = 0;
    this.spotCount = 0;
    this._ambR = 0;
    this._ambG = 0;
    this._ambB = 0;
    this.overflow = 0;
    return this;
  }

  /** 环境光：多个环境光按「颜色 × 强度」累加 */
  addAmbient(color: Color, intensity = 1): this {
    this._ambR += color.r * intensity;
    this._ambG += color.g * intensity;
    this._ambB += color.b * intensity;
    return this;
  }

  /**
   * 方向光。
   * @param direction 光的传播方向（世界空间；内部会归一化）
   * @returns 是否写入成功（超出上限返回 false）
   */
  addDirectional(direction: Vec3, color: Color, intensity = 1): boolean {
    if (this.dirCount >= MAX_DIRECTIONAL_LIGHTS) {
      this.overflow++;
      return false;
    }
    const i = this.dirCount++;
    const len = direction.length() || 1;
    const base = OFFSET.dirDir + i * STRIDE;
    this.data[base] = direction.x / len;
    this.data[base + 1] = direction.y / len;
    this.data[base + 2] = direction.z / len;
    const c = OFFSET.dirColor + i * STRIDE;
    this.data[c] = color.r * intensity;
    this.data[c + 1] = color.g * intensity;
    this.data[c + 2] = color.b * intensity;
    return true;
  }

  /**
   * 点光。
   * @param position 世界位置
   * @param distance 影响距离（0 = 无限，仅按 decay 衰减）
   * @param decay 衰减指数（默认 2 = 物理平方反比）
   */
  addPoint(position: Vec3, color: Color, intensity = 1, distance = 0, decay = 2): boolean {
    if (this.pointCount >= MAX_POINT_LIGHTS) {
      this.overflow++;
      return false;
    }
    const i = this.pointCount++;
    const p = OFFSET.pointPos + i * STRIDE;
    this.data[p] = position.x;
    this.data[p + 1] = position.y;
    this.data[p + 2] = position.z;
    this.data[p + 3] = distance;
    const c = OFFSET.pointColor + i * STRIDE;
    this.data[c] = color.r * intensity;
    this.data[c + 1] = color.g * intensity;
    this.data[c + 2] = color.b * intensity;
    this.data[c + 3] = decay;
    return true;
  }

  /**
   * 聚光（衰减与点光一致：1/d^decay，默认平方反比）。
   * @param angle 外锥半角（弧度）
   * @param penumbra 0（硬边）~1（全软）
   */
  addSpot(
    position: Vec3,
    direction: Vec3,
    color: Color,
    intensity = 1,
    distance = 0,
    angle = Math.PI / 6,
    penumbra = 0.25,
  ): boolean {
    if (this.spotCount >= MAX_SPOT_LIGHTS) {
      this.overflow++;
      return false;
    }
    const i = this.spotCount++;
    const p = OFFSET.spotPos + i * STRIDE;
    this.data[p] = position.x;
    this.data[p + 1] = position.y;
    this.data[p + 2] = position.z;
    this.data[p + 3] = distance;

    const len = direction.length() || 1;
    const d = OFFSET.spotDir + i * STRIDE;
    this.data[d] = direction.x / len;
    this.data[d + 1] = direction.y / len;
    this.data[d + 2] = direction.z / len;
    const outer = Math.max(0, Math.min(1, Math.cos(angle)));
    this.data[d + 3] = outer;

    const c = OFFSET.spotColor + i * STRIDE;
    this.data[c] = color.r * intensity;
    this.data[c + 1] = color.g * intensity;
    this.data[c + 2] = color.b * intensity;
    const pn = Math.max(0, Math.min(1, penumbra));
    this.data[c + 3] = Math.cos(angle * (1 - pn));
    return true;
  }

  /** 写入环境光与各类型数量（`add*` 之后调用一次） */
  finish(): void {
    this.data[OFFSET.ambient] = this._ambR;
    this.data[OFFSET.ambient + 1] = this._ambG;
    this.data[OFFSET.ambient + 2] = this._ambB;
    this.data[OFFSET.ambient + 3] = 0;
    this.data[OFFSET.counts] = this.dirCount;
    this.data[OFFSET.counts + 1] = this.pointCount;
    this.data[OFFSET.counts + 2] = this.spotCount;
    this.data[OFFSET.counts + 3] = 0;
  }

  /**
   * 默认光照（场景里没有任何灯时使用）：与框架早起版本写死在 shader 里的
   * `0.35 + 0.65·max(dot(n, normalize(0.35,0.75,0.55)),0)` 一致，
   * 因此「不加灯」的老示例观感不变。
   */
  fillDefault(): this {
    this.reset();
    // 与历史 shader 常量严格等价：0.35(环境) + 0.65·max(dot(n, normalize(0.35,0.75,0.55)), 0)
    this.addAmbient(WHITE, 0.35);
    this.addDirectional(new Vec3(-0.35, -0.75, -0.55), WHITE, 0.65);
    this.finish();
    return this;
  }

  /** 从另一份打包数据整体复制（用于把外部灯光状态喂进复用缓冲） */
  fillFrom(other: LightsState): this {
    this.data.set(other.data);
    this.dirCount = other.dirCount;
    this.pointCount = other.pointCount;
    this.spotCount = other.spotCount;
    this.overflow = other.overflow;
    return this;
  }
}

const WHITE = new Color(1, 1, 1, 1);
/** 历史 shader 里写死的「指向光源」方向（默认方向光的反方向） */
export const DEFAULT_LIGHT_DIRECTION = new Vec3(0.35, 0.75, 0.55);
