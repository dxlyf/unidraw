import type { Device } from "../device/Device.js";
import type { BindGroup, BindGroupLayout, Program, RenderPipeline } from "../device/resources.js";
import type { BindGroupEntryDescriptor, BindGroupLayoutEntryDescriptor } from "../device/descriptors.js";
import type { TextureFormat } from "../gpu/types.js";
import type { RenderPassEncoder } from "../command/encoder.js";
import type { Vec3 } from "../math/vec3.js";
import { Mat4 } from "../math/mat4.js";
import { UniformBlock } from "./UniformBlock.js";
import { ColorWriteMask } from "../device/descriptors.js";
import { assert } from "../util/assert.js";
import type { Geometry } from "./Geometry.js";
import { Mesh } from "./Mesh.js";
import { CAMERA_FIELDS, MATERIAL_FIELDS, MODEL_FIELDS, STANDARD_VERTEX_STATE, defaultBlendState, defaultGroupEntries, depthFormatOf, targetFormatOf } from "./materialCommon.js";
import { LIGHTS_FIELDS, LightsState } from "./lights/LightsState.js";
import { MAX_SHADOW_MAPS } from "./shadow/constants.js";
import { SHADOW_BLOCK_BINDING, SHADOW_SAMPLER_BINDING, SHADOW_TEXTURE_BINDING } from "./shadow/ShadowState.js";
import { shadowResources } from "./shadow/ShadowResources.js";

const EMPTY_OFFSETS: readonly number[] = [];

export interface MaterialOptions {
  /** 颜色附件格式；缺省使用画布格式 */
  targetFormat?: TextureFormat;
  /** 是否启用深度测试/写入（默认 true） */
  depth?: boolean;
  /** 背面剔除（默认 back；2D 用 none） */
  cullMode?: "none" | "front" | "back";
  /** 与深度附件匹配的深度格式（默认 depth24plus） */
  depthFormat?: TextureFormat;
  /** 启用标准 alpha 混合（半透明） */
  alphaBlend?: boolean;
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
export abstract class BaseMaterial {
  protected readonly device: Device;
  protected readonly layout: BindGroupLayout;
  /** 默认管线（sampleCount = 1 或构造时的 `MaterialOptions.sampleCount`） */
  protected readonly pipeline: RenderPipeline;
  /** 按附件采样数缓存的管线（MSAA 场景目标会自动用到，材质侧无需关心） */
  private readonly _pipelinesBySamples = new Map<number, RenderPipeline>();
  private readonly _program: Program;
  private readonly _opts: MaterialOptions;
  protected readonly cameraBlock: UniformBlock;
  protected modelBlock: UniformBlock;
  protected readonly materialBlock: UniformBlock;
  /** 灯光 UBO（binding 3）：由 `beginFrame(vp, eye, lights)` 写入 */
  protected readonly lightsBlock: UniformBlock;
  /** 由子类在所有资源就绪后通过 assembleBindGroup() 建立 */
  protected bindGroup!: BindGroup;
  private _modelSlotCursor = 0;
  private _modelSlotCount: number;
  private _seenSubmitCount: number;
  private _unhookFlush: (() => void) | null = null;
  /** 未显式传入灯光时使用的默认光（复用缓冲） */
  private readonly _lightsState: LightsState;
  /** 所有需要「提交前合批上传」的块（含扩容替换下来的旧块） */
  private readonly _flushBlocks: UniformBlock[] = [];
  /** 上次建 bind group 时的阴影资源版本（贴图池变化时重建） */
  private _shadowVersion = -1;
  /** 是否接收阴影（false 时布局/绑定都不含阴影槽位） */
  private readonly _receiveShadows: boolean;

  /**
   * 按附件的采样数取管线。WebGPU 要求管线的 `multisample.count` 与附件一致，
   * 因此使用 MSAA 渲染目标（`RenderTarget({ sampleCount: 4 })`）时会自动
   * 为同一材质创建一份 4x 管线 —— 调用方无需关心。
   */
  private _pipelineFor(sampleCount: number): RenderPipeline {
    const cached = this._pipelinesBySamples.get(sampleCount);
    if (cached) return cached;
    const pipeline = this._createPipeline(sampleCount, targetFormatOf(this.device, this._opts), this._opts.depth !== false);
    this._pipelinesBySamples.set(sampleCount, pipeline);
    return pipeline;
  }

  private _createPipeline(sampleCount: number, targetFormat: TextureFormat, depth: boolean): RenderPipeline {
    const depthOnly = this._opts.depthOnly === true;
    return this.device.createRenderPipeline({
      label: this._opts.label ? `${this._opts.label}${sampleCount > 1 ? `-msaa${sampleCount}` : ""}` : undefined,
      program: this._program,
      bindGroupLayouts: [this.layout],
      vertex: STANDARD_VERTEX_STATE,
      primitive: { topology: "triangle-list", cullMode: this._opts.cullMode ?? "back", frontFace: "ccw" },
      depthStencil:
        depth === false
          ? null
          : { format: depthFormatOf(this.device, this._opts), depthWriteEnabled: true, depthCompare: "less-equal" },
      targets: depthOnly
        ? []
        : [
            {
              format: targetFormat,
              writeMask: ColorWriteMask.ALL,
              blend: this._opts.alphaBlend ? defaultBlendState() : undefined,
            },
          ],
      multisample: { count: sampleCount },
    });
  }

  protected constructor(device: Device, program: Program, opts: MaterialOptions, extraLayoutEntries: BindGroupLayoutEntryDescriptor[] = []) {
    this.device = device;
    this._program = program;
    this._opts = opts;
    this._receiveShadows = opts.receiveShadows !== false;
    const targetFormat = targetFormatOf(device, opts);
    const depth = opts.depth !== false;
    this.layout = device.createBindGroupLayout({
      label: opts.label ? `${opts.label}-layout` : undefined,
      entries: [...defaultGroupEntries({ shadows: this._receiveShadows }), ...extraLayoutEntries],
    });
    this.pipeline = this._createPipeline(1, targetFormat, depth);
    this._pipelinesBySamples.set(1, this.pipeline);
    this.cameraBlock = new UniformBlock(device, { label: opts.label ? `${opts.label}-camera` : "camera", fields: CAMERA_FIELDS });
    this._modelSlotCount = Math.max(1, Math.floor(opts.modelRingSlots ?? 4));
    this.modelBlock = new UniformBlock(device, {
      label: opts.label ? `${opts.label}-model` : "model",
      fields: MODEL_FIELDS,
      slots: this._modelSlotCount,
    });
    this.materialBlock = new UniformBlock(device, { label: opts.label ? `${opts.label}-material` : "material", fields: MATERIAL_FIELDS });
    this.lightsBlock = new UniformBlock(device, { label: opts.label ? `${opts.label}-lights` : "lights", fields: LIGHTS_FIELDS });
    this._lightsState = new LightsState().fillDefault();
    this._seenSubmitCount = device.submitCount;

    // 逐 draw 写入的块只进 CPU 暂存，提交前由设备钩子一次性上传。
    // 注意：必须把**所有创建过的**环形块都登记进来 —— 扩容时旧块仍被此前的 draw 引用，
    // 漏掉它们会导致早期物体的模型矩阵永远不上传（ID pass 里物体直接消失/塌到原点）。
    this._flushBlocks.push(this.cameraBlock, this.modelBlock, this.materialBlock, this.lightsBlock);
    this._unhookFlush = device.onBeforeSubmit(() => {
      for (let i = 0; i < this._flushBlocks.length; i++) this._flushBlocks[i]!.flushPending();
    });
  }

  /**
   * 子类注册「需要随提交前一起上传」的额外 UBO 块（例如 ID 材质的 IdBlock）。
   *
   * `flushSlot()` 是延迟上传（提交前合批），凡是逐 draw 写入的块都必须登记，
   * 否则数据永远不会到达 GPU（表现为该块内容恒为 0）。
   */
  protected registerFlushBlock(block: UniformBlock): void {
    this._flushBlocks.push(block);
  }

  /** 所有需要提交前上传的 UBO 块（含扩容替换下来的旧块；调试用） */
  get flushBlocks(): readonly UniformBlock[] {
    return this._flushBlocks;
  }

  /** 当前 bind group（调试/测试/自检用；建组之后可用） */
  get bindGroupResource(): BindGroup {
    return this.bindGroup;
  }

  /** bind group 布局条目（调试/测试用；例如确认声明了哪些 binding） */
  get layoutEntries(): readonly BindGroupLayoutEntryDescriptor[] {
    return this.layout.entries;
  }

  /** 由子类提供 group 资源（含额外 texture/sampler）。 */
  protected abstract createBindGroup(): BindGroup;

  /** 标准 bind group 条目：0=相机、1=模型（动态偏移）、2=材质、3=灯光、6..14=阴影。 */
  protected baseBindGroupEntries(): BindGroupEntryDescriptor[] {
    const entries: BindGroupEntryDescriptor[] = [
      { binding: 0, resource: this.cameraBlock.buffer },
      { binding: 1, resource: this.modelBlock.buffer, offset: 0, size: this.modelBlock.stride },
      { binding: 2, resource: this.materialBlock.buffer },
      { binding: 3, resource: this.lightsBlock.buffer },
    ];
    if (!this._receiveShadows) return entries;
    const shadows = shadowResources(this.device);
    entries.push({ binding: SHADOW_BLOCK_BINDING, resource: shadows.block.buffer });
    for (let i = 0; i < MAX_SHADOW_MAPS; i++) {
      entries.push({ binding: SHADOW_TEXTURE_BINDING + i, resource: shadows.mapView(i) });
    }
    for (let i = 0; i < MAX_SHADOW_MAPS; i++) {
      entries.push({ binding: SHADOW_SAMPLER_BINDING + i, resource: shadows.sampler });
    }
    return entries;
  }

  /**
   * 建立 bind group。必须在子类自己的资源（颜色/纹理/采样器）就绪后调用，
   * 因为 WebGPU 的 BindGroup 必须覆盖 layout 声明的全部 binding。
   */
  protected assembleBindGroup(): void {
    this.bindGroup = this.createBindGroup();
  }

  protected layoutOf(): BindGroupLayout {
    return this.layout;
  }

  /**
   * 每帧开始时上传相机（viewProj/cameraPos）与灯光，并重置模型矩阵环形槽。
   *
   * @param lights 灯光打包数据（`SceneRenderer` 自动提供）；
   *               省略时使用默认光（环境 0.35 + 方向光 0.65），保证「不加灯也有光照」。
   */
  beginFrame(viewProjection: Mat4, cameraPos?: Vec3, lights?: LightsState): void {
    // 阴影贴图池/尺寸变化后，bind group 引用的纹理视图会失效 → 重建
    if (this._receiveShadows) {
      const shadows = shadowResources(this.device);
      if (shadows.version !== this._shadowVersion) {
        this._shadowVersion = shadows.version;
        this.assembleBindGroup();
      }
    }
    this.cameraBlock.setMat4("u_viewProj", viewProjection);
    this.cameraBlock.setVec4("u_cameraPos", cameraPos?.x ?? 0, cameraPos?.y ?? 0, cameraPos?.z ?? 0, 1);
    this.cameraBlock.flush();
    const state = lights ?? this._lightsState.fillDefault();
    // LightsState.data 就是本块 std140 布局的字节内容，整块一次拷入
    this.lightsBlock.setRaw(state.data);
    this.lightsBlock.flush();
    this._modelSlotCursor = 0;
  }

  /** 写 u_params：x=shininess、y=spec 强度、z=ambient、w=保留（按材质含义） */
  setMaterialParams(x = 0, y = 0, z = 0, w = 0): this {
    this.materialBlock.setVec4("u_params", x, y, z, w);
    this.materialBlock.flush();
    return this;
  }

  /**
   * 子类可覆盖：写入自己的「逐绘制动态块」，返回额外的动态偏移。
   *
   * 返回值按 binding 升序追加在模型矩阵偏移之后（与 WebGPU 动态偏移顺序一致）。
   * 调用时 `slot` 是本次绘制占用的环形槽序号，子类的动态块需要同容量的槽。
   */
  protected extraDynamicOffsets(_slot: number): readonly number[] {
    return EMPTY_OFFSETS;
  }

  /** 绘制一个 mesh。 */
  draw(pass: RenderPassEncoder, mesh: Mesh): void {
    this.drawGeometry(pass, mesh.geometry, mesh.model);
  }

  /** 绘制任意几何体 + 模型矩阵。 */
  drawGeometry(pass: RenderPassEncoder, geometry: Geometry, model: Mat4): void {
    // 槽位只要在一次提交内互不相同即可：检测到新的 submit 就安全复用
    const submits = this.device.submitCount;
    if (submits !== this._seenSubmitCount) {
      this._seenSubmitCount = submits;
      this._modelSlotCursor = 0;
    }
    if (this._modelSlotCursor >= this._modelSlotCount) this.growModelRing(this._modelSlotCursor + 1);
    const slot = this._modelSlotCursor++;

    this.modelBlock.setMat4("u_model", model);
    this.modelBlock.flushSlot(slot);
    const extra = this.extraDynamicOffsets(slot);

    // 管线/绑定组状态由后端做冗余消除；这里始终记录，避免多材质交替时状态错乱
    pass.setPipeline(this._pipelineFor(pass.sampleCount));
    pass.setBindGroup(0, this.bindGroup, [slot * this.modelBlock.stride, ...extra]);
    pass.setVertexBuffer(0, geometry.vertexBuffer);
    if (geometry.indexFormat) {
      assert(geometry.indexBuffer, "有 indexFormat 就必须有 indexBuffer");
      pass.setIndexBuffer(geometry.indexBuffer, geometry.indexFormat);
      pass.drawIndexed(geometry.indexCount);
    } else {
      pass.draw(geometry.vertexCount);
    }
  }

  /** 模型矩阵环形缓冲的槽数量（子类动态块需要保持同容量）。 */
  protected get modelSlotCount(): number {
    return this._modelSlotCount;
  }

  /** 扩容模型矩阵环形缓冲（同一帧内共享材质绘制对象数超出容量时）。 */
  private growModelRing(needed: number): void {
    const slots = Math.max(needed, this._modelSlotCount * 2);
    this.modelBlock = new UniformBlock(this.device, {
      label: this.modelBlock.label ? `${this.modelBlock.label}-ring${slots}` : "model",
      fields: MODEL_FIELDS,
      slots,
    });
    this._modelSlotCount = slots;
    // 旧块仍被此前的 draw 引用：保持存活，并继续纳入「提交前上传」列表
    this._flushBlocks.push(this.modelBlock);
    this.assembleBindGroup();
  }

  /** 释放材质占用的设备钩子（材质销毁时调用；正常情况下随 device 一起释放）。 */
  dispose(): void {
    this._unhookFlush?.();
    this._unhookFlush = null;
  }

  get pipelineHandle(): RenderPipeline {
    return this.pipeline;
  }
}
