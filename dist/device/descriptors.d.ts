import type { BufferUsageFlags, ColorClearValue, CompareFunction, CullMode, FrontFace, LoadOp, PrimitiveTopology, ShaderStageFlags, StoreOp, TextureFormat, TextureUsageFlags, TextureDimension, VertexFormat, VertexStepMode } from "../gpu/types.js";
import type { BindGroupLayout, Buffer, Program, Sampler, TextureView } from "./resources.js";
export interface BufferDescriptor {
    label?: string;
    /** 字节大小 */
    size: number;
    usage: BufferUsageFlags;
}
export interface BufferWriteOptions {
    offset?: number;
}
export interface TextureDescriptor {
    label?: string;
    width: number;
    height: number;
    format: TextureFormat;
    usage: TextureUsageFlags;
    mipLevelCount?: number;
    /**
     * 维度（默认 `"2d"`）。
     *
     * - `"2d"`：普通二维纹理；
     * - `"3d"`：体纹理（`depthOrArrayLayers` = 深度）；
     * - `"2d-array"`：二维数组（`depthOrArrayLayers` = 层数）；
     * - `"cube"`：立方体贴图（`depthOrArrayLayers` 固定 6，每个面一个层）。
     *
     * 两个后端都支持；采样时着色器要按维度声明（`sampler3D` / `sampler2DArray` /
     * `samplerCube`），框架只负责创建、上传与绑定。
     */
    dimension?: TextureDimension;
    /**
     * 3D 深度 / 数组层数 / cube 的面数（cube 必须省略或写 6；默认 1）。
     */
    depthOrArrayLayers?: number;
    /**
     * 采样数（MSAA）：1 = 普通纹理（默认）。
     *
     * - 多采样纹理只能作为渲染附件，不能采样；渲染结果需要 `resolveTo` 到一张普通纹理
     *   （见 `RenderTarget`，它会把两者一起管好）；
     * - WebGL2 用多重采样 renderbuffer 实现（纹理句柄仅作标识）；
     * - 上限由 `device.limits.maxSamples` 给出。
     */
    sampleCount?: number;
}
export interface TextureUploadOptions {
    x?: number;
    y?: number;
    /** 3D 纹理的 z / 数组或 cube 的层号（默认 0） */
    z?: number;
    /** 默认 texture 宽度 */
    width?: number;
    /** 默认 texture 高度 */
    height?: number;
    /** 3D 纹理一次上传的深度（默认 1） */
    depth?: number;
    /** 源数据每行字节数；缺省按 width*bytesPerTexel */
    bytesPerRow?: number;
    /** 源数据每层字节数（3D/数组）；缺省按 bytesPerRow*height */
    bytesPerImage?: number;
    mipLevel?: number;
}
export interface SamplerDescriptor {
    label?: string;
    addressModeU?: "clamp-to-edge" | "repeat" | "mirror-repeat";
    addressModeV?: "clamp-to-edge" | "repeat" | "mirror-repeat";
    addressModeW?: "clamp-to-edge" | "repeat" | "mirror-repeat";
    magFilter?: "nearest" | "linear";
    minFilter?: "nearest" | "linear";
    mipmapFilter?: "nearest" | "linear";
    maxAnisotropy?: number;
    /**
     * 是否启用 mipmap 过滤。缺省 false（只使用 base level）。
     * 注意（WebGL2）：minFilter 组合 mip 变体（如 LINEAR_MIPMAP_LINEAR）时，
     * 纹理必须拥有完整 mip 链（mipLevelCount>1 且已生成），否则属于“不完整纹理”，
     * 采样结果为未定义（常见发灰/黑）。开启本项请同时使用可 mip 的纹理。
     */
    mips?: boolean;
}
export interface GlslProgramSource {
    /** GLSL ES 3.00 vertex shader */
    vertex: string;
    /** GLSL ES 3.00 fragment shader */
    fragment: string;
}
export interface WgslProgramSource {
    /** 含 @vertex/@fragment 入口的 WGSL 模块 */
    code: string;
    vertexEntryPoint?: string;
    fragmentEntryPoint?: string;
}
export interface ProgramDescriptor {
    label?: string;
    /** WebGL2 后端源码（必填，若要支持 WebGL2） */
    glsl?: GlslProgramSource;
    /** WebGPU 后端源码（必填，若要支持 WebGPU） */
    wgsl?: WgslProgramSource;
}
export interface VertexAttributeDescriptor {
    /** 着色器 location */
    location: number;
    format: VertexFormat;
    /** 相对该 buffer 起始的字节偏移 */
    offset: number;
}
export interface VertexBufferLayoutDescriptor {
    arrayStride: number;
    stepMode?: VertexStepMode;
    attributes: VertexAttributeDescriptor[];
}
export interface VertexStateDescriptor {
    buffers: VertexBufferLayoutDescriptor[];
}
export interface BlendComponentDescriptor {
    srcFactor: "zero" | "one" | "src" | "one-minus-src" | "src-alpha" | "one-minus-src-alpha" | "dst" | "one-minus-dst" | "dst-alpha" | "one-minus-dst-alpha" | "src-alpha-saturated" | "constant" | "one-minus-constant";
    dstFactor: "zero" | "one" | "src" | "one-minus-src" | "src-alpha" | "one-minus-src-alpha" | "dst" | "one-minus-dst" | "dst-alpha" | "one-minus-dst-alpha" | "src-alpha-saturated" | "constant" | "one-minus-constant";
    operation: "add" | "subtract" | "reverse-subtract" | "min" | "max";
}
export interface BlendStateDescriptor {
    color: BlendComponentDescriptor;
    alpha: BlendComponentDescriptor;
}
export interface ColorTargetDescriptor {
    format: TextureFormat;
    /** 缺省不混合 */
    blend?: BlendStateDescriptor;
    /** RGBA 各通道写入开关，缺省全开 */
    writeMask?: number;
}
export declare const ColorWriteMask: {
    readonly RED: number;
    readonly GREEN: number;
    readonly BLUE: number;
    readonly ALPHA: number;
    readonly ALL: 15;
};
/**
 * BindGroupLayout 的“内容指纹”：内容相同的布局可以安全共用，
 * 从而在 WebGL2 后端只分配一次 UBO binding point / 纹理单元
 * （避免大量同构材质把有限的 binding 资源耗尽）。
 */
export declare function bindGroupLayoutCacheKey(desc: BindGroupLayoutDescriptor): string;
export interface DepthStencilStateDescriptor {
    format: TextureFormat;
    depthWriteEnabled: boolean;
    depthCompare: CompareFunction;
}
export interface PrimitiveStateDescriptor {
    topology: PrimitiveTopology;
    cullMode: CullMode;
    frontFace: FrontFace;
}
export interface RenderPipelineDescriptor {
    label?: string;
    program: Program;
    /** 供 shader 使用的 bind group 布局（按 index 对应 setBindGroup） */
    bindGroupLayouts: BindGroupLayout[];
    vertex: VertexStateDescriptor;
    primitive?: Partial<PrimitiveStateDescriptor>;
    depthStencil?: DepthStencilStateDescriptor | null;
    /** 每个颜色附件一个 target；格式必须与实际附件匹配 */
    targets: ColorTargetDescriptor[];
    /**
     * 多重采样状态（WebGPU 需要与附件 `sampleCount` 一致；WebGL2/Mock 忽略，
     * 因为多重采样在那里是 framebuffer 的属性）。
     */
    multisample?: {
        count: number;
    };
}
export type BindGroupEntryType = "uniform-buffer" | "texture" | "sampler";
/**
 * 纹理采样的样本类型（WebGPU `GPUTextureSampleType` 的子集）。
 *
 * - `"float"`（默认）：可过滤浮点纹理；
 * - `"unfilterable-float"`：不可过滤（例如 `r32float`），只能用 nearest 采样器 / `textureLoad`；
 * - `"depth"`：深度纹理（`texture_depth_2d`，配 `textureLoad` 手动比较，阴影贴图用）。
 */
export type TextureSampleType = "float" | "unfilterable-float" | "depth" | "sint" | "uint";
export interface BindGroupLayoutEntryDescriptor {
    /** 与 WGSL @binding 一致；GLSL 后端按 name 映射 */
    binding: number;
    type: BindGroupEntryType;
    visibility: ShaderStageFlags;
    /** 着色器名称（GLSL uniform/UBO block 名；WGSL var 名提示） */
    name?: string;
    /**
     * uniform buffer 使用「动态偏移」（WebGPU `hasDynamicOffset` / WebGL2 `bindBufferRange`）。
     * 用于「同一个 bind group + 同一个 buffer，逐次绘制换一段数据」的高频场景
     * （例如共享材质的逐物体模型矩阵），避免为每个物体创建 UBO/bind group。
     */
    hasDynamicOffset?: boolean;
    /** 纹理样本类型（仅 `type: "texture"` 有意义；默认 `"float"`） */
    sampleType?: TextureSampleType;
}
export interface BindGroupLayoutDescriptor {
    label?: string;
    entries: BindGroupLayoutEntryDescriptor[];
}
export type BindGroupResource = Buffer | Sampler | TextureView;
export interface BindGroupEntryDescriptor {
    binding: number;
    resource: BindGroupResource;
    /** 资源在 buffer 内的字节偏移（动态偏移 entry 的基准偏移） */
    offset?: number;
    /** 绑定区间字节数（缺省到 buffer 末尾；动态偏移 UBO 建议显式给出 block 大小） */
    size?: number;
}
export interface BindGroupDescriptor {
    label?: string;
    layout: BindGroupLayout;
    entries: BindGroupEntryDescriptor[];
}
export interface RenderPassColorAttachmentDescriptor {
    /** null 表示渲染到 canvas（交换链） */
    view: TextureView | null;
    clearValue?: ColorClearValue;
    loadOp?: LoadOp;
    storeOp?: StoreOp;
    /** MSAA 解析目标（`view` 为多采样附件时必填，否则结果不可采样） */
    resolveTo?: TextureView | null;
    /** 附件采样数（默认 1；由 `RenderTarget.colorAttachment()` 自动填好） */
    sampleCount?: number;
}
export interface RenderPassDepthStencilAttachmentDescriptor {
    /** null 表示 canvas 设备管理的深度附件（随窗口大小自动重建） */
    view: TextureView | null;
    depthLoadOp?: LoadOp;
    depthStoreOp?: StoreOp;
    depthClearValue?: number;
    /** 深度附件采样数（MSAA 时必须与颜色附件一致） */
    sampleCount?: number;
}
export interface RenderPassDescriptor {
    label?: string;
    colorAttachments: (RenderPassColorAttachmentDescriptor | null)[];
    depthStencilAttachment?: RenderPassDepthStencilAttachmentDescriptor | null;
}
export declare function defaultPrimitiveState(): PrimitiveStateDescriptor;
export declare function defaultSamplerDescriptor(): SamplerDescriptor;
//# sourceMappingURL=descriptors.d.ts.map