import type { Device } from "../device/Device.js";
import type { BindGroup } from "../device/resources.js";
import type { Color } from "../math/color.js";
import type { MaterialOptions } from "./BaseMaterial.js";
import { BaseMaterial } from "./BaseMaterial.js";
export interface PhongMaterialOptions extends MaterialOptions {
    /** 高光指数（默认 48） */
    shininess?: number;
    /** 高光强度（默认 0.7） */
    specular?: number;
    /** 环境光系数（默认 0.18） */
    ambient?: number;
}
/**
 * Blinn-Phong 材质：diffuse + 镜面高光（白色高光）。绘制前请用
 * `beginFrame(vp, camera.eyePosition)` 传入相机位置。
 */
export declare class PhongMaterial extends BaseMaterial {
    private readonly _color;
    private shininess;
    private specular;
    private ambient;
    constructor(device: Device, color: Color, opts?: PhongMaterialOptions);
    private flushMaterial;
    get color(): Color;
    setColor(color: Color): this;
    setShininess(v: number): this;
    setSpecular(v: number): this;
    setAmbient(v: number): this;
    protected createBindGroup(): BindGroup;
}
//# sourceMappingURL=PhongMaterial.d.ts.map