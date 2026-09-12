import type { Device } from "../device/Device.js";
import type { BindGroup, Texture } from "../device/resources.js";
import { Color } from "../math/color.js";
import type { MaterialOptions } from "./BaseMaterial.js";
import { BaseMaterial } from "./BaseMaterial.js";
export interface StandardMaterialOptions extends MaterialOptions {
    /** 基础色（hex 字符串或 Color），默认白 */
    color?: Color | string;
    /** 粗糙度 0..1，默认 1 */
    roughness?: number;
    /** 金属度 0..1，默认 0 */
    metalness?: number;
    /** 自发光颜色，默认黑 */
    emissive?: Color | string;
    /** 自发光强度，默认 1 */
    emissiveIntensity?: number;
    /** 基础色贴图（binding 4） */
    map?: Texture | null;
    /** 切线空间法线贴图（binding 5） */
    normalMap?: Texture | null;
    /** 法线强度，默认 1 */
    normalScale?: number;
}
/**
 * metallic-roughness PBR 材质（对齐 three.js 的 `MeshStandardMaterial`）。
 *
 * 直接光用 Cook-Torrance（GGX + Smith + Schlick），环境光用「无 IBL 的常量辐照度」近似；
 * 灯光与阴影复用框架的 `LightsBlock` / `unidrawShadow`，与 Phong/Texture 材质同一套语义。
 * 绘制前请用 `beginFrame(vp, camera.eyePosition)` 传入相机位置（同 PhongMaterial）。
 *
 * 输出与 Phong 一致：**线性值、不做 tone mapping / gamma**（框架在后处理里统一处理）。
 */
export declare class StandardMaterial extends BaseMaterial {
    private readonly _color;
    private readonly _emissive;
    private _roughness;
    private _metalness;
    private _emissiveIntensity;
    private _normalScale;
    private _map;
    private _normalMap;
    /** 两张贴图共用的采样器（repeat + linear；缺省不启用 mipmap 过滤） */
    private readonly _sampler;
    /** 未设置贴图时绑定的占位纹理（bind group 必须覆盖 layout 声明的全部 binding） */
    private readonly _whiteTexture;
    private readonly _flatNormalTexture;
    /** PBR 参数块（binding 17）：u_emissive + u_flags */
    private readonly standardBlock;
    constructor(device: Device, colorOrOptions?: Color | string | StandardMaterialOptions, opts?: StandardMaterialOptions);
    private static createPlaceholderTexture;
    /**
     * 把材质参数写进 UBO 并立即上传。
     *
     * `u_color.rgb` 直接使用 Color 的当前分量（与 Phong/Texture 材质一致：框架不在材质侧做
     * sRGB→线性转换，需要线性空间请自行 `toLinear()`，贴图则用 `rgba8unorm-srgb` 格式让硬件解码）。
     */
    private flushMaterial;
    /** 换贴图后重建 bind group（`u_flags` 也一并更新，决定着色器是否使用该贴图）。 */
    private applyTextures;
    get color(): Color;
    /** 与 `StandardMaterialOptions.color` 一致，接受 hex 字符串 */
    set color(value: Color | string);
    setColor(value: Color | string): this;
    get roughness(): number;
    /** 粗糙度，写入时 clamp 到 [0, 1] */
    set roughness(value: number);
    setRoughness(value: number): this;
    get metalness(): number;
    /** 金属度，写入时 clamp 到 [0, 1] */
    set metalness(value: number);
    setMetalness(value: number): this;
    get emissive(): Color;
    /** 自发光颜色（hex 字符串或 Color） */
    set emissive(value: Color | string);
    setEmissive(value: Color | string): this;
    get emissiveIntensity(): number;
    /** 自发光强度，写入时 clamp 到 >= 0 */
    set emissiveIntensity(value: number);
    setEmissiveIntensity(value: number): this;
    get normalScale(): number;
    /** 法线强度，写入时 clamp 到 >= 0 */
    set normalScale(value: number);
    setNormalScale(value: number): this;
    /** 基础色贴图（binding 4）；`null` = 只用 `color` */
    get map(): Texture | null;
    set map(value: Texture | null);
    setMap(value: Texture | null): this;
    /** 切线空间法线贴图（binding 5）；`null` = 不扰动法线 */
    get normalMap(): Texture | null;
    set normalMap(value: Texture | null);
    setNormalMap(value: Texture | null): this;
    protected createBindGroup(): BindGroup;
}
//# sourceMappingURL=StandardMaterial.d.ts.map