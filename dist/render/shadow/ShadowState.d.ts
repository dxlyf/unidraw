/**
 * ShadowState —— 阴影数据的 CPU 打包（std140）—— 与着色器里的 `ShadowBlock` 一一对应。
 *
 * 布局（共 4×16 + 4×4 + 4×4 + 4 = 100 个 float = 400 字节）：
 * ```
 * u_shadowMatrix[4]   mat4 × 4     // 光源视投影矩阵
 * u_shadowParams[4]   vec4 × 4     // x=归一化深度偏移 y=1/边长 z=类型(0 方向光/1 聚光) w=光源序号
 * u_shadowParams2[4]  vec4 × 4     // x=PCF 半径(纹素) y=法线偏移(世界) z=滤波方式 w=阴影强度
 * u_shadowMeta        vec4         // x=有效贴图数量
 * ```
 *
 * `bias` 由调用方换算成**归一化深度**（世界单位偏移 / 阴影相机深度范围），
 * 这样参数与场景尺度无关；WebGL2 的窗口深度只有一半范围，着色器里再乘 0.5。
 */
import { type UniformField } from "../../gpu/std140.js";
import type { ShadowMap } from "./ShadowMap.js";
/** 阴影贴图类型：0 = 方向光，1 = 聚光 */
export declare const SHADOW_KIND_DIRECTIONAL = 0;
export declare const SHADOW_KIND_SPOT = 1;
export declare const SHADOW_FIELDS: UniformField[];
/** 绑定固定为 `@group(0) @binding(6)`（0/1/2/3 被相机/模型/材质/灯光占用） */
export declare const SHADOW_BLOCK_BINDING = 6;
/** 阴影贴图纹理起始 binding（7..10） */
export declare const SHADOW_TEXTURE_BINDING = 7;
/** 阴影贴图采样器起始 binding（11..14；WebGL2 需要与纹理**按序配对**） */
export declare const SHADOW_SAMPLER_BINDING = 11;
/**
 * 一帧的阴影状态：可复用的打包缓冲（`data` 直接上传到 UBO，零分配）。
 */
export declare class ShadowState {
    /** 打包好的 std140 数据（float 数） */
    readonly data: Float32Array;
    /** 本帧有效的贴图数量 */
    count: number;
    /** 本帧使用到的贴图（长度 = count；供调试/自检读取） */
    readonly maps: ShadowMap[];
    constructor();
    reset(): this;
    /**
     * 追加一张阴影贴图。
     *
     * @param map 贴图（矩阵已由 `ShadowRenderer` 填好）
     * @param kind `SHADOW_KIND_DIRECTIONAL` / `SHADOW_KIND_SPOT`
     * @param lightIndex 该光源在打包灯光数组里的序号（方向光/聚光各自独立编号）
     * @param options `bias` 是**归一化深度**（世界单位偏移 / 深度范围，由调用方换算）；
     *                `normalBias` 是**世界单位**；`filter`/`intensity` 见 `ShadowSettings`
     * @returns 是否写入成功（超过 `MAX_SHADOW_MAPS` 返回 false）
     */
    add(map: ShadowMap, kind: number, lightIndex: number, options: {
        bias: number;
        radius: number;
        normalBias: number;
        /** 滤波方式编码：0 硬边 / 1 3x3 / 2 5x5 */
        filter?: number;
        /** 阴影强度 0..1 */
        intensity?: number;
    }): boolean;
    /** 写入有效贴图数量（`add()` 之后调用一次） */
    finish(): void;
}
//# sourceMappingURL=ShadowState.d.ts.map