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
import { Mat4 as Mat4Class } from "../../math/mat4.js";
import { BaseMaterial } from "../BaseMaterial.js";
import { SHADOW_DEPTH_FRAGMENT_GLSL, SHADOW_DEPTH_FRAGMENT_WGSL } from "./shadowShaders.js";
import { VERTEX_GLSL, VERTEX_WGSL } from "../shaders/standard.js";
export class ShadowDepthMaterial extends BaseMaterial {
    /** 光照相机矩阵（由 `ShadowRenderer` 每个光源设置一次） */
    _lightMatrix = new Mat4Class();
    constructor(device, options = {}) {
        super(device, device.createProgram({
            label: options.label ? `${options.label}-program` : "unidraw-shadow-depth-program",
            glsl: { vertex: VERTEX_GLSL, fragment: SHADOW_DEPTH_FRAGMENT_GLSL },
            wgsl: { code: VERTEX_WGSL + SHADOW_DEPTH_FRAGMENT_WGSL },
        }), {
            ...options,
            label: options.label ?? "unidraw-shadow-depth",
            depthOnly: true,
            // 深度 pass 不需要（也不允许）绑定阴影贴图：WebGPU 禁止同一次提交内
            // 把同一张纹理既当附件写、又当只读纹理资源绑定
            receiveShadows: false,
            targetFormat: undefined,
            alphaBlend: false,
            cullMode: options.cullMode ?? "front",
            depthFormat: options.depthFormat ?? "depth32float",
        });
        this._lightMatrix.setIdentity();
        this.assembleBindGroup();
    }
    /** 设置本帧要渲染的光源视投影（渲染该光源的阴影贴图前调用一次） */
    setLightMatrix(matrix) {
        this._lightMatrix.copy(matrix);
        return this;
    }
    /** 覆盖 `beginFrame`：阴影 pass 用的是光源矩阵，而不是主相机矩阵 */
    beginFrame(_viewProjection, _cameraPos, _lights) {
        super.beginFrame(this._lightMatrix);
    }
    createBindGroup() {
        return this.device.createBindGroup({ label: "shadow-depth-group", layout: this.layout, entries: this.baseBindGroupEntries() });
    }
}
//# sourceMappingURL=ShadowDepthMaterial.js.map