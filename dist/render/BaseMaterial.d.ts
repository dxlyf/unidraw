import type { Device } from "../device/Device.js";
import type { BindGroup, BindGroupLayout, Program, RenderPipeline } from "../device/resources.js";
import type { BindGroupEntryDescriptor, BindGroupLayoutEntryDescriptor, BlendStateDescriptor } from "../device/descriptors.js";
import type { TextureFormat } from "../gpu/types.js";
import type { RenderPassEncoder } from "../command/encoder.js";
import type { Vec3 } from "../math/vec3.js";
import { Mat4 } from "../math/mat4.js";
import { UniformBlock } from "./UniformBlock.js";
import type { Geometry } from "./Geometry.js";
import { Mesh } from "./Mesh.js";
import type { InstancedDrawSource } from "../scene/types.js";
import { LightsState } from "./lights/LightsState.js";
export interface MaterialOptions {
    /** 颜色附件格式；缺省使用画布格式 */
    targetFormat?: TextureFormat;
    /** 是否启用深度测试/写入（默认 true） */
    depth?: boolean;
    /** 背面剔除（默认 back；2D 用 none） */
    cullMode?: "none" | "front" | "back";
    /** 与深度附件匹配的深度格式（默认 depth24plus） */
    depthFormat?: TextureFormat;
    /** 启用标准 alpha 混合（半透明：src-alpha / one-minus-src-alpha） */
    alphaBlend?: boolean;
    /**
     * 自定义混合状态（颜色与 alpha 各一份 src/dst factor + operation）。
     *
     * 设置后不必再开 `alphaBlend`；材质会被标记为**半透明**（`isTransparent`），
     * `SceneRenderer` 会把它排在不透明物体之后并按距离**远→近**绘制。
     */
    blend?: BlendStateDescriptor;
    /**
     * 是否写深度（默认 true）。
     *
     * 半透明物体通常设 `false`：不写深度就不会挡住后面的半透明物体，
     * 但仍参与深度测试（会被不透明物体正确遮挡）。
     */
    depthWrite?: boolean;
    /**
     * 只写深度（阴影贴图等）：管线不带颜色附件。
     *
     * 需要配合 `beginRenderPass({ colorAttachments: [], depthStencilAttachment })` 使用
     * （WebGL2 会走「无颜色附件的 FBO + drawBuffers(NONE)」路径）。
     */
    depthOnly?: boolean;
    /**
     * 是否接收阴影（默认 true）：false 时 bind group 里不声明/不绑定阴影贴图。
     *
     * 阴影贴图 pass 用的深度材质必须设为 false —— WebGPU 不允许同一次提交内
     * 某张纹理既作为附件写入、又作为只读纹理资源绑定。
     */
    receiveShadows?: boolean;
    /**
     * 自定义的**实例化顶点着色器**（配合 `InstancedMesh`）。
     *
     * 内置材质不需要传：`BaseMaterial` 发现顶点源码就是标准的 `VERTEX_GLSL`/`VERTEX_WGSL`
     * 时会自动换成实例化版本；只有自定义顶点着色器的材质（例如 ID 材质）才需要提供。
     */
    instancedVertex?: {
        glsl: string;
        wgsl: string;
    };
    /** 每帧最多绘制的物体数（模型矩阵环形槽初始容量，超出自动扩容） */
    modelRingSlots?: number;
    label?: string;
}
/**
 * 基础材质：统一布局 + 相机/模型/材质 UBO。
 *
 * 关于「共享材质」：同一个材质实例可以被任意多个 Mesh 复用。
 * 逐物体的模型矩阵放在一个**动态偏移环形 UBO**里（每次绘制占一个对齐槽），
 * 因此一次绘制 = `setPipeline` + `setBindGroup(0, group, [slot*stride])`，
 * 不需要为每个物体创建 UBO / bind group / 管线（状态最小化）。
 * 环形游标在 `beginFrame()` 或检测到一次新的 `device.submit()` 时归零 ——
 * 槽位只要在一次提交内互不相同即正确。
 */
export declare abstract class BaseMaterial {
    protected readonly device: Device;
    protected readonly layout: BindGroupLayout;
    /** 默认管线（sampleCount = 1 或构造时的 `MaterialOptions.sampleCount`） */
    protected readonly pipeline: RenderPipeline;
    /** 按附件采样数缓存的管线（MSAA 场景目标会自动用到，材质侧无需关心） */
    private readonly _pipelinesBySamples;
    private readonly _program;
    private readonly _opts;
    protected readonly cameraBlock: UniformBlock;
    protected modelBlock: UniformBlock;
    protected readonly materialBlock: UniformBlock;
    /** 灯光 UBO（binding 3）：由 `beginFrame(vp, eye, lights)` 写入 */
    protected readonly lightsBlock: UniformBlock;
    /** 由子类在所有资源就绪后通过 assembleBindGroup() 建立 */
    protected bindGroup: BindGroup;
    private _modelSlotCursor;
    private _modelSlotCount;
    private _seenSubmitCount;
    private _unhookFlush;
    /** 未显式传入灯光时使用的默认光（复用缓冲） */
    private readonly _lightsState;
    /** 所有需要「提交前合批上传」的块（含扩容替换下来的旧块） */
    private readonly _flushBlocks;
    /** 上次建 bind group 时的阴影资源版本（贴图池变化时重建） */
    private _shadowVersion;
    /** 逐 draw 复用的动态偏移数组（避免在热路径上分配） */
    private readonly _drawOffsets;
    /** 是否接收阴影（false 时布局/绑定都不含阴影槽位） */
    private readonly _receiveShadows;
    /** 实例化管线（按「实例化 + 采样数」缓存；首次 `drawInstanced` 时创建） */
    private readonly _instancedPipelines;
    /** 实例化程序（顶点着色器换成实例化版本；null = 该材质不支持实例化） */
    private _instancedProgram;
    /** 退化路径用的临时矩阵（材质不支持实例化时逐实例绘制） */
    private readonly _fallbackMatrix;
    /**
     * 按附件的采样数取管线。WebGPU 要求管线的 `multisample.count` 与附件一致，
     * 因此使用 MSAA 渲染目标（`RenderTarget({ sampleCount: 4 })`）时会自动
     * 为同一材质创建一份 4x 管线 —— 调用方无需关心。
     */
    private _pipelineFor;
    /** 实例化管线（顶点流多一条 `stepMode: "instance"` 的实例矩阵流） */
    private _instancedPipelineFor;
    private _createPipeline;
    /**
     * 找到（或构造）实例化程序：把标准顶点着色器换成实例化版本。
     *
     * 内置材质都用 `VERTEX_GLSL`/`VERTEX_WGSL`，因此这里按字符串前缀/相等识别即可；
     * 自定义顶点着色器的材质可通过 `MaterialOptions.instancedVertex` 显式提供。
     */
    private _resolveInstancedProgram;
    protected constructor(device: Device, program: Program, opts: MaterialOptions, extraLayoutEntries?: BindGroupLayoutEntryDescriptor[]);
    /**
     * 子类注册「需要随提交前一起上传」的额外 UBO 块（例如 ID 材质的 IdBlock）。
     *
     * `flushSlot()` 是延迟上传（提交前合批），凡是逐 draw 写入的块都必须登记，
     * 否则数据永远不会到达 GPU（表现为该块内容恒为 0）。
     */
    protected registerFlushBlock(block: UniformBlock): void;
    /** 所有需要提交前上传的 UBO 块（含扩容替换下来的旧块；调试用） */
    get flushBlocks(): readonly UniformBlock[];
    /** 当前 bind group（调试/测试/自检用；建组之后可用） */
    get bindGroupResource(): BindGroup;
    /** bind group 布局条目（调试/测试用；例如确认声明了哪些 binding） */
    get layoutEntries(): readonly BindGroupLayoutEntryDescriptor[];
    /** 由子类提供 group 资源（含额外 texture/sampler）。 */
    protected abstract createBindGroup(): BindGroup;
    /** 标准 bind group 条目：0=相机、1=模型（动态偏移）、2=材质、3=灯光、6..14=阴影。 */
    protected baseBindGroupEntries(): BindGroupEntryDescriptor[];
    /**
     * 建立 bind group。必须在子类自己的资源（颜色/纹理/采样器）就绪后调用，
     * 因为 WebGPU 的 BindGroup 必须覆盖 layout 声明的全部 binding。
     */
    protected assembleBindGroup(): void;
    protected layoutOf(): BindGroupLayout;
    /**
     * 每帧开始时上传相机（viewProj/cameraPos）与灯光，并重置模型矩阵环形槽。
     *
     * @param lights 灯光打包数据（`SceneRenderer` 自动提供）；
     *               省略时使用默认光（环境 0.35 + 方向光 0.65），保证「不加灯也有光照」。
     */
    beginFrame(viewProjection: Mat4, cameraPos?: Vec3, lights?: LightsState): void;
    /** 写 u_params：x=shininess、y=spec 强度、z=ambient、w=保留（按材质含义） */
    setMaterialParams(x?: number, y?: number, z?: number, w?: number): this;
    /**
     * 子类可覆盖：写入自己的「逐绘制动态块」，返回额外的动态偏移。
     *
     * 返回值按 binding 升序追加在模型矩阵偏移之后（与 WebGPU 动态偏移顺序一致）。
     * 调用时 `slot` 是本次绘制占用的环形槽序号，子类的动态块需要同容量的槽。
     */
    protected extraDynamicOffsets(_slot: number): readonly number[];
    /**
     * 材质是否半透明（`alphaBlend` 或自定义 `blend` 都算）。
     *
     * `SceneRenderer` 用它决定排序：不透明物体近→远（利于 early-z），
     * 半透明物体远→近（正确的叠加顺序）。
     */
    get isTransparent(): boolean;
    /** 管线的混合状态：自定义 `blend` 优先，其次 `alphaBlend` 的标准混合 */
    private _resolveBlend;
    /** 绘制一个 mesh。 */
    draw(pass: RenderPassEncoder, mesh: Mesh): void;
    /**
     * 一次绘制多个实例（`InstancedMesh`）。
     *
     * - 有实例化管线时：绑定实例矩阵顶点流（slot 1）+ **一次** `draw(instanceCount)`；
     * - 没有（材质用了自定义顶点着色器且未提供 `instancedVertex`）时：
     *   退化成 N 次 `drawGeometry`（正确性优先，性能退化在日志/文档里有说明）。
     */
    drawInstanced(pass: RenderPassEncoder, geometry: Geometry, model: Mat4, source: InstancedDrawSource): void;
    /** 记录管线/绑定组/顶点流（普通与实例化绘制共用；返回本帧占用的环形槽序号） */
    private _recordDrawState;
    /** 绘制任意几何体 + 模型矩阵。 */
    drawGeometry(pass: RenderPassEncoder, geometry: Geometry, model: Mat4): void;
    /** 模型矩阵环形缓冲的槽数量（子类动态块需要保持同容量）。 */
    protected get modelSlotCount(): number;
    /** 扩容模型矩阵环形缓冲（同一帧内共享材质绘制对象数超出容量时）。 */
    private growModelRing;
    /** 释放材质占用的设备钩子（材质销毁时调用；正常情况下随 device 一起释放）。 */
    dispose(): void;
    get pipelineHandle(): RenderPipeline;
}
//# sourceMappingURL=BaseMaterial.d.ts.map