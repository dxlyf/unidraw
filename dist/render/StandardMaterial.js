import { TextureUsage } from "../gpu/types.js";
import { Color } from "../math/color.js";
import { FRAGMENT_GLSL, FRAGMENT_WGSL, VERTEX_GLSL, VERTEX_WGSL } from "./shaders.js";
import { UniformBlock } from "./UniformBlock.js";
import { BaseMaterial } from "./BaseMaterial.js";
/** binding：4/5 = 材质自己的两张纹理（与布局里的采样器按顺序配对） */
const BINDING_ALBEDO = 4;
const BINDING_NORMAL_MAP = 5;
/** binding：15/16 = 上面两张纹理的采样器，17 = PBR 参数 UBO（`StandardBlock`） */
const BINDING_ALBEDO_SAMPLER = 15;
const BINDING_NORMAL_SAMPLER = 16;
const BINDING_STANDARD_BLOCK = 17;
/**
 * 材质自己的额外 binding。
 *
 * 标准布局已占用 0..3 与 6..14（6=ShadowBlock、7..10 阴影贴图、11..14 阴影采样器），
 * 所以两张纹理放 4/5（与 `standard.ts` 里 `u_albedo` / `u_normalMap` 对应），采样器放 15/16。
 *
 * 注意 WebGL2 后端把**纹理与采样器按各自的声明顺序配对**（见 `GLBindGroupLayout.textureUnits`），
 * 因此两者的条目数量必须一致 —— 即使两张贴图共用同一个 `Sampler` 对象，也要声明两个条目。
 */
const STANDARD_EXTRA_ENTRIES = [
    { binding: BINDING_ALBEDO, type: "texture", visibility: 2, name: "u_albedo" },
    { binding: BINDING_NORMAL_MAP, type: "texture", visibility: 2, name: "u_normalMap" },
    { binding: BINDING_ALBEDO_SAMPLER, type: "sampler", visibility: 2, name: "u_albedoSampler" },
    { binding: BINDING_NORMAL_SAMPLER, type: "sampler", visibility: 2, name: "u_normalSampler" },
    { binding: BINDING_STANDARD_BLOCK, type: "uniform-buffer", visibility: 2, name: "StandardBlock" },
];
/** `StandardBlock`：u_emissive = rgb 颜色 + w 强度；u_flags = (有 map, 有 normalMap) */
const STANDARD_FIELDS = [
    { name: "u_emissive", type: "vec4" },
    { name: "u_flags", type: "vec4" },
];
/** 基础色贴图的 1×1 占位（白色 = 乘法中性元） */
const WHITE_PIXEL = new Uint8Array([255, 255, 255, 255]);
/** 法线贴图的 1×1 占位（切线空间法线 = (0, 0, 1)，采样后解码成不扰动法线） */
const FLAT_NORMAL_PIXEL = new Uint8Array([128, 128, 255, 255]);
/** 默认基础色 / 自发光（构造时 clone，避免外部改到共享实例） */
const DEFAULT_COLOR = new Color(1, 1, 1, 1);
const DEFAULT_EMISSIVE = new Color(0, 0, 0, 1);
function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
/** 把 `Color | string` 统一成 Color（hex 字符串走 `Color.setHex`）。 */
function resolveColor(value, fallback) {
    if (value === undefined)
        return fallback.clone();
    if (typeof value === "string")
        return new Color().setHex(value);
    return value.clone();
}
function applyColor(target, value) {
    if (typeof value === "string")
        target.setHex(value);
    else
        target.copy(value);
}
/**
 * 兼容两种构造风格：
 * - `new StandardMaterial(device, "#ffaa33", { roughness: 0.4 })`（与 PhongMaterial 等内置材质一致）；
 * - `new StandardMaterial(device, { color: "#ffaa33", roughness: 0.4 })`（对齐 three.js 的 options 写法）。
 */
function normalizeOptions(arg, extra) {
    if (arg instanceof Color || typeof arg === "string")
        return { ...extra, color: arg };
    return arg;
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
export class StandardMaterial extends BaseMaterial {
    _color;
    _emissive;
    _roughness;
    _metalness;
    _emissiveIntensity;
    _normalScale;
    _map = null;
    _normalMap = null;
    /** 两张贴图共用的采样器（repeat + linear；缺省不启用 mipmap 过滤） */
    _sampler;
    /** 未设置贴图时绑定的占位纹理（bind group 必须覆盖 layout 声明的全部 binding） */
    _whiteTexture;
    _flatNormalTexture;
    /** PBR 参数块（binding 17）：u_emissive + u_flags */
    standardBlock;
    constructor(device, colorOrOptions = {}, opts = {}) {
        const options = normalizeOptions(colorOrOptions, opts);
        const program = device.createProgram({
            label: options.label ?? "unidraw-standard-program",
            glsl: { vertex: VERTEX_GLSL, fragment: FRAGMENT_GLSL },
            wgsl: { code: VERTEX_WGSL + FRAGMENT_WGSL },
        });
        super(device, program, options, STANDARD_EXTRA_ENTRIES);
        this._color = resolveColor(options.color, DEFAULT_COLOR);
        this._emissive = resolveColor(options.emissive, DEFAULT_EMISSIVE);
        this._roughness = clamp01(options.roughness ?? 1);
        this._metalness = clamp01(options.metalness ?? 0);
        this._emissiveIntensity = Math.max(0, options.emissiveIntensity ?? 1);
        this._normalScale = Math.max(0, options.normalScale ?? 1);
        this._map = options.map ?? null;
        this._normalMap = options.normalMap ?? null;
        const label = options.label;
        this._sampler = device.createSampler({
            label: label ? `${label}-sampler` : "standard-sampler",
            addressModeU: "repeat",
            addressModeV: "repeat",
            magFilter: "linear",
            minFilter: "linear",
            mipmapFilter: "nearest",
            mips: false,
        });
        this._whiteTexture = StandardMaterial.createPlaceholderTexture(device, label ? `${label}-white` : "standard-white", WHITE_PIXEL);
        this._flatNormalTexture = StandardMaterial.createPlaceholderTexture(device, label ? `${label}-flat-normal` : "standard-flat-normal", FLAT_NORMAL_PIXEL);
        this.standardBlock = new UniformBlock(device, {
            label: label ? `${label}-standard` : "standard",
            fields: STANDARD_FIELDS,
        });
        this.flushMaterial();
        this.assembleBindGroup();
    }
    static createPlaceholderTexture(device, label, pixel) {
        const texture = device.createTexture({
            label,
            width: 1,
            height: 1,
            format: "rgba8unorm",
            usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST,
        });
        texture.upload(pixel);
        return texture;
    }
    /**
     * 把材质参数写进 UBO 并立即上传。
     *
     * `u_color.rgb` 直接使用 Color 的当前分量（与 Phong/Texture 材质一致：框架不在材质侧做
     * sRGB→线性转换，需要线性空间请自行 `toLinear()`，贴图则用 `rgba8unorm-srgb` 格式让硬件解码）。
     */
    flushMaterial() {
        this.materialBlock.setColor("u_color", this._color);
        this.materialBlock.setVec4("u_params", this._roughness, this._metalness, this._normalScale, 0);
        this.materialBlock.flush();
        this.standardBlock.setVec4("u_emissive", this._emissive.r, this._emissive.g, this._emissive.b, this._emissiveIntensity);
        this.standardBlock.setVec4("u_flags", this._map ? 1 : 0, this._normalMap ? 1 : 0, 0, 0);
        this.standardBlock.flush();
    }
    /** 换贴图后重建 bind group（`u_flags` 也一并更新，决定着色器是否使用该贴图）。 */
    applyTextures() {
        this.flushMaterial();
        this.assembleBindGroup();
    }
    get color() {
        return this._color;
    }
    /** 与 `StandardMaterialOptions.color` 一致，接受 hex 字符串 */
    set color(value) {
        this.setColor(value);
    }
    setColor(value) {
        applyColor(this._color, value);
        this.flushMaterial();
        return this;
    }
    get roughness() {
        return this._roughness;
    }
    /** 粗糙度，写入时 clamp 到 [0, 1] */
    set roughness(value) {
        this.setRoughness(value);
    }
    setRoughness(value) {
        this._roughness = clamp01(value);
        this.flushMaterial();
        return this;
    }
    get metalness() {
        return this._metalness;
    }
    /** 金属度，写入时 clamp 到 [0, 1] */
    set metalness(value) {
        this.setMetalness(value);
    }
    setMetalness(value) {
        this._metalness = clamp01(value);
        this.flushMaterial();
        return this;
    }
    get emissive() {
        return this._emissive;
    }
    /** 自发光颜色（hex 字符串或 Color） */
    set emissive(value) {
        this.setEmissive(value);
    }
    setEmissive(value) {
        applyColor(this._emissive, value);
        this.flushMaterial();
        return this;
    }
    get emissiveIntensity() {
        return this._emissiveIntensity;
    }
    /** 自发光强度，写入时 clamp 到 >= 0 */
    set emissiveIntensity(value) {
        this.setEmissiveIntensity(value);
    }
    setEmissiveIntensity(value) {
        this._emissiveIntensity = Math.max(0, value);
        this.flushMaterial();
        return this;
    }
    get normalScale() {
        return this._normalScale;
    }
    /** 法线强度，写入时 clamp 到 >= 0 */
    set normalScale(value) {
        this.setNormalScale(value);
    }
    setNormalScale(value) {
        this._normalScale = Math.max(0, value);
        this.flushMaterial();
        return this;
    }
    /** 基础色贴图（binding 4）；`null` = 只用 `color` */
    get map() {
        return this._map;
    }
    set map(value) {
        this.setMap(value);
    }
    setMap(value) {
        this._map = value;
        this.applyTextures();
        return this;
    }
    /** 切线空间法线贴图（binding 5）；`null` = 不扰动法线 */
    get normalMap() {
        return this._normalMap;
    }
    set normalMap(value) {
        this.setNormalMap(value);
    }
    setNormalMap(value) {
        this._normalMap = value;
        this.applyTextures();
        return this;
    }
    createBindGroup() {
        return this.device.createBindGroup({
            label: "standardmaterial-group",
            layout: this.layout,
            entries: [
                ...this.baseBindGroupEntries(),
                { binding: BINDING_ALBEDO, resource: (this._map ?? this._whiteTexture).view() },
                { binding: BINDING_NORMAL_MAP, resource: (this._normalMap ?? this._flatNormalTexture).view() },
                { binding: BINDING_ALBEDO_SAMPLER, resource: this._sampler },
                { binding: BINDING_NORMAL_SAMPLER, resource: this._sampler },
                { binding: BINDING_STANDARD_BLOCK, resource: this.standardBlock.buffer },
            ],
        });
    }
}
//# sourceMappingURL=StandardMaterial.js.map