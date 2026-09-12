/**
 * ShadowDepthMaterial —— 阴影贴图用的「只写深度」材质。
 *
 * - 顶点着色器与内置材质共用（同一个顶点格式 + CameraBlock/ModelBlock 布局），
 *   fragment 为空（`depthOnly: true` → 管线不带颜色附件）；
 * - 为了让深度测试能剔除背面（减少自阴影），默认 `cullMode: "front"`
 *   （即只渲染背向光源的面）—— 这是阴影贴图的经典做法：物体正面不写深度，
 *   遮挡比较时就不会被自己的正面「挡住」；
 * - 每个光源一个实例（`beginFrame(lightMatrix)` 写入光照相机矩阵），
 *   也可以所有光源共用实例（渲染前逐光源调一次 `setLightMatrix`）。
 */
import type { Device } from "../../device/Device.js";
import type { BindGroup } from "../../device/resources.js";
import type { Mat4 } from "../../math/mat4.js";
import type { Vec3 } from "../../math/vec3.js";
import type { LightsState } from "../lights/LightsState.js";
import { BaseMaterial, type MaterialOptions } from "../BaseMaterial.js";
export interface ShadowDepthMaterialOptions extends MaterialOptions {
    /** 剔除方式（默认 `"front"`：只画背面，抑制自阴影条纹） */
    cullMode?: "none" | "front" | "back";
    /** 深度格式（默认 depth32float，与 `ShadowMap` 一致） */
    depthFormat?: "depth32float" | "depth24plus";
}
export declare class ShadowDepthMaterial extends BaseMaterial {
    /** 光照相机矩阵（由 `ShadowRenderer` 每个光源设置一次） */
    private readonly _lightMatrix;
    constructor(device: Device, options?: ShadowDepthMaterialOptions);
    /** 设置本帧要渲染的光源视投影（渲染该光源的阴影贴图前调用一次） */
    setLightMatrix(matrix: Mat4): this;
    /** 覆盖 `beginFrame`：阴影 pass 用的是光源矩阵，而不是主相机矩阵 */
    beginFrame(_viewProjection?: Mat4, _cameraPos?: Vec3, _lights?: LightsState): void;
    protected createBindGroup(): BindGroup;
}
//# sourceMappingURL=ShadowDepthMaterial.d.ts.map