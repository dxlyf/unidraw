import type { Device } from "../device/Device.js";
import type { BindGroup, BindGroupLayout, Program, RenderPipeline } from "../device/resources.js";
import type { BindGroupEntryDescriptor } from "../device/descriptors.js";
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
  protected readonly pipeline: RenderPipeline;
  protected readonly cameraBlock: UniformBlock;
  protected modelBlock: UniformBlock;
  protected readonly materialBlock: UniformBlock;
  /** 由子类在所有资源就绪后通过 assembleBindGroup() 建立 */
  protected bindGroup!: BindGroup;
  private _modelSlotCursor = 0;
  private _modelSlotCount: number;
  private _seenSubmitCount: number;

  protected constructor(device: Device, program: Program, opts: MaterialOptions, extraLayoutEntries: { binding: number; type: "uniform-buffer" | "texture" | "sampler"; visibility: number; name?: string }[] = []) {
    this.device = device;
    const targetFormat = targetFormatOf(device, opts);
    const depth = opts.depth !== false;
    this.layout = device.createBindGroupLayout({
      label: opts.label ? `${opts.label}-layout` : undefined,
      entries: [...defaultGroupEntries(), ...extraLayoutEntries],
    });
    this.pipeline = device.createRenderPipeline({
      label: opts.label,
      program,
      bindGroupLayouts: [this.layout],
      vertex: STANDARD_VERTEX_STATE,
      primitive: { topology: "triangle-list", cullMode: opts.cullMode ?? "back", frontFace: "ccw" },
      depthStencil:
        depth === false
          ? null
          : { format: depthFormatOf(device, opts), depthWriteEnabled: true, depthCompare: "less-equal" },
      targets: [{ format: targetFormat, writeMask: ColorWriteMask.ALL, blend: opts.alphaBlend ? defaultBlendState() : undefined }],
    });
    this.cameraBlock = new UniformBlock(device, { label: opts.label ? `${opts.label}-camera` : "camera", fields: CAMERA_FIELDS });
    this._modelSlotCount = Math.max(1, Math.floor(opts.modelRingSlots ?? 4));
    this.modelBlock = new UniformBlock(device, {
      label: opts.label ? `${opts.label}-model` : "model",
      fields: MODEL_FIELDS,
      slots: this._modelSlotCount,
    });
    this.materialBlock = new UniformBlock(device, { label: opts.label ? `${opts.label}-material` : "material", fields: MATERIAL_FIELDS });
    this._seenSubmitCount = device.submitCount;
  }

  /** 由子类提供 group 资源（含额外 texture/sampler）。 */
  protected abstract createBindGroup(): BindGroup;

  /** 标准 bind group 条目：0=相机、1=模型（动态偏移）、2=材质。 */
  protected baseBindGroupEntries(): BindGroupEntryDescriptor[] {
    return [
      { binding: 0, resource: this.cameraBlock.buffer },
      { binding: 1, resource: this.modelBlock.buffer, offset: 0, size: this.modelBlock.stride },
      { binding: 2, resource: this.materialBlock.buffer },
    ];
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

  /** 每帧开始时上传相机（viewProj/cameraPos）并重置模型矩阵环形槽。 */
  beginFrame(viewProjection: Mat4, cameraPos?: Vec3): void {
    this.cameraBlock.setMat4("u_viewProj", viewProjection);
    this.cameraBlock.setVec4("u_cameraPos", cameraPos?.x ?? 0, cameraPos?.y ?? 0, cameraPos?.z ?? 0, 1);
    this.cameraBlock.flush();
    this._modelSlotCursor = 0;
  }

  /** 写 u_params：x=shininess、y=spec 强度、z=ambient、w=保留（按材质含义） */
  setMaterialParams(x = 0, y = 0, z = 0, w = 0): this {
    this.materialBlock.setVec4("u_params", x, y, z, w);
    this.materialBlock.flush();
    return this;
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

    // 管线/绑定组状态由后端做冗余消除；这里始终记录，避免多材质交替时状态错乱
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup, [slot * this.modelBlock.stride]);
    pass.setVertexBuffer(0, geometry.vertexBuffer);
    if (geometry.indexFormat) {
      assert(geometry.indexBuffer, "有 indexFormat 就必须有 indexBuffer");
      pass.setIndexBuffer(geometry.indexBuffer, geometry.indexFormat);
      pass.drawIndexed(geometry.indexCount);
    } else {
      pass.draw(geometry.vertexCount);
    }
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
    // 旧的 buffer/bind group 已记录在之前的命令里，保持存活直到 device 销毁
    this.assembleBindGroup();
  }

  get pipelineHandle(): RenderPipeline {
    return this.pipeline;
  }
}
