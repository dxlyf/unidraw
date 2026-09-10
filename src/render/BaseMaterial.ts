import type { Device } from "../device/Device.js";
import type { BindGroup, BindGroupLayout, Program, RenderPipeline } from "../device/resources.js";
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
  label?: string;
}


/**
 * 基础材质：统一布局 + 相机/模型/材质 UBO。
 */
export abstract class BaseMaterial {
  protected readonly device: Device;
  protected readonly layout: BindGroupLayout;
  protected readonly pipeline: RenderPipeline;
  protected readonly cameraBlock: UniformBlock;
  protected readonly modelBlock: UniformBlock;
  protected readonly materialBlock: UniformBlock;
  /** 由子类在所有资源就绪后通过 assembleBindGroup() 建立 */
  protected bindGroup!: BindGroup;
  private _lastPass: RenderPassEncoder | null = null;

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
    this.modelBlock = new UniformBlock(device, { label: opts.label ? `${opts.label}-model` : "model", fields: MODEL_FIELDS });
    this.materialBlock = new UniformBlock(device, { label: opts.label ? `${opts.label}-material` : "material", fields: MATERIAL_FIELDS });
  }

  /** 由子类提供 group 资源（含额外 texture/sampler）。 */
  protected abstract createBindGroup(): BindGroup;

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

  /** 每帧开始时上传相机（viewProj/cameraPos）。 */
  beginFrame(viewProjection: Mat4, cameraPos?: Vec3): void {
    this.cameraBlock.setMat4("u_viewProj", viewProjection);
    this.cameraBlock.setVec4("u_cameraPos", cameraPos?.x ?? 0, cameraPos?.y ?? 0, cameraPos?.z ?? 0, 1);
    this.cameraBlock.flush();
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
    if (this._lastPass !== pass) {
      this._lastPass = pass;
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroup);
    }
    this.modelBlock.setMat4("u_model", model);
    this.modelBlock.flush();
    pass.setVertexBuffer(0, geometry.vertexBuffer);
    if (geometry.indexFormat) {
      assert(geometry.indexBuffer, "有 indexFormat 就必须有 indexBuffer");
      pass.setIndexBuffer(geometry.indexBuffer, geometry.indexFormat);
      pass.drawIndexed(geometry.indexCount);
    } else {
      pass.draw(geometry.vertexCount);
    }
  }

  get pipelineHandle(): RenderPipeline {
    return this.pipeline;
  }
}
