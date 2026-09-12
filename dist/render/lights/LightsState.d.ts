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
import { type UniformField } from "../../gpu/std140.js";
/** 单个着色器里支持的方向光上限 */
export declare const MAX_DIRECTIONAL_LIGHTS = 4;
/** 点光上限 */
export declare const MAX_POINT_LIGHTS = 8;
/** 聚光上限 */
export declare const MAX_SPOT_LIGHTS = 4;
export declare const LIGHTS_FIELDS: UniformField[];
/**
 * 一帧的灯光状态：可复用的打包缓冲（`data` 直接上传到 UBO，零分配）。
 *
 * 用法：`reset()` → 若干 `addAmbient/addDirectional/addPoint/addSpot` → `finish()`。
 * 没有任何灯时用 `fillDefault()` 写入一套默认光，保证「不写灯也有光照」的历史观感。
 */
export declare class LightsState {
    /** 打包好的 std140 数据（float 数 = 152） */
    readonly data: Float32Array;
    dirCount: number;
    pointCount: number;
    spotCount: number;
    private _ambR;
    private _ambG;
    private _ambB;
    /** 超出上限被忽略的灯数量（用于提示/自检） */
    overflow: number;
    constructor();
    reset(): this;
    /** 环境光：多个环境光按「颜色 × 强度」累加 */
    addAmbient(color: Color, intensity?: number): this;
    /**
     * 方向光。
     * @param direction 光的传播方向（世界空间；内部会归一化）
     * @returns 是否写入成功（超出上限返回 false）
     */
    addDirectional(direction: Vec3, color: Color, intensity?: number): boolean;
    /**
     * 点光。
     * @param position 世界位置
     * @param distance 影响距离（0 = 无限，仅按 decay 衰减）
     * @param decay 衰减指数（默认 2 = 物理平方反比）
     */
    addPoint(position: Vec3, color: Color, intensity?: number, distance?: number, decay?: number): boolean;
    /**
     * 聚光（衰减与点光一致：1/d^decay，默认平方反比）。
     * @param angle 外锥半角（弧度）
     * @param penumbra 0（硬边）~1（全软）
     */
    addSpot(position: Vec3, direction: Vec3, color: Color, intensity?: number, distance?: number, angle?: number, penumbra?: number): boolean;
    /** 写入环境光与各类型数量（`add*` 之后调用一次） */
    finish(): void;
    /**
     * 默认光照（场景里没有任何灯时使用）：与框架早起版本写死在 shader 里的
     * `0.35 + 0.65·max(dot(n, normalize(0.35,0.75,0.55)),0)` 一致，
     * 因此「不加灯」的老示例观感不变。
     */
    fillDefault(): this;
    /** 从另一份打包数据整体复制（用于把外部灯光状态喂进复用缓冲） */
    fillFrom(other: LightsState): this;
}
/** 历史 shader 里写死的「指向光源」方向（默认方向光的反方向） */
export declare const DEFAULT_LIGHT_DIRECTION: Vec3;
//# sourceMappingURL=LightsState.d.ts.map