/**
 * 内置材质：ColorMaterial / TextureMaterial / BlitMaterial。
 *
 * 材质持有一个 BindGroupLayout + RenderPipeline + 三个 UBO（camera/model/material），
 * 统一按下列约定工作（详见 shaders.ts）：
 *
 *   material.beginFrame(viewProjection, cameraPos?)   // 每帧一次
 *   material.draw(pass, mesh)                         // 每个 mesh 一次
 */

import type { Device } from "../device/Device.js";
import type { BindGroup, BindGroupLayout, Program, RenderPipeline, Texture } from "../device/resources.js";
import { type Sampler } from "../device/resources.js";
import type { VertexStateDescriptor } from "../device/descriptors.js";
import type { TextureFormat } from "../gpu/types.js";
import type { RenderPassEncoder } from "../command/encoder.js";
import type { Color } from "../math/color.js";
import type { Vec3 } from "../math/vec3.js";
import { Mat4 } from "../math/mat4.js";
import { UniformBlock } from "./UniformBlock.js";
import type { UniformField } from "../gpu/std140.js";
import { ColorWriteMask } from "../device/descriptors.js";
import { assert } from "../util/assert.js";
import type { Geometry } from "./Geometry.js";
import { Mesh } from "./Mesh.js";
import {
  COLOR_FRAGMENT_GLSL,
  COLOR_FRAGMENT_WGSL,
  TEXTURE_FRAGMENT_GLSL,
  TEXTURE_FRAGMENT_WGSL,
  VERTEX_GLSL,
  VERTEX_WGSL,
} from "./shaders.js";

// ---------------------------------------------------------------------------
// UBO 字段与标准顶点状态
// ---------------------------------------------------------------------------

export const CAMERA_FIELDS: UniformField[] = [
  { name: "u_viewProj", type: "mat4" },
  { name: "u_cameraPos", type: "vec4" },
];
export const MODEL_FIELDS: UniformField[] = [{ name: "u_model", type: "mat4" }];
export const MATERIAL_FIELDS: UniformField[] = [{ name: "u_color", type: "vec4" }];

export const STANDARD_VERTEX_STATE: VertexStateDescriptor = {
  buffers: [
    {
      arrayStride: 32,
      stepMode: "vertex",
      attributes: [
        { location: 0, format: "float32x3", offset: 0 },
        { location: 1, format: "float32x3", offset: 12 },
        { location: 2, format: "float32x2", offset: 24 },
      ],
    },
  ],
};

const VS_FRAGMENT_VISIBILITY = 3; // VERTEX | FRAGMENT

export interface MaterialOptions {
  /** 颜色附件格式；缺省使用画布格式 */
  targetFormat?: TextureFormat;
  /** 是否启用深度测试/写入（默认 true） */
  depth?: boolean;
  /** 背面剔除（默认 back；2D 用 none） */
  cullMode?: "none" | "front" | "back";
  /** 与深度附件匹配的深度格式（默认 depth24plus） */
  depthFormat?: TextureFormat;
  label?: string;
}

function depthFormatOf(_device: Device, opts: MaterialOptions): TextureFormat {
  return (opts.depthFormat ?? "depth24plus") as TextureFormat;
}

function targetFormatOf(device: Device, opts: MaterialOptions): TextureFormat {
  if (opts.targetFormat) return opts.targetFormat;
  return (device.canvasFormat?.() ?? "rgba8unorm") as TextureFormat;
}

function defaultGroupEntries(): { binding: number; type: "uniform-buffer"; visibility: number; name: string }[] {
  return [
    { binding: 0, type: "uniform-buffer", visibility: VS_FRAGMENT_VISIBILITY, name: "CameraBlock" },
    { binding: 1, type: "uniform-buffer", visibility: VS_FRAGMENT_VISIBILITY, name: "ModelBlock" },
    { binding: 2, type: "uniform-buffer", visibility: VS_FRAGMENT_VISIBILITY, name: "MaterialBlock" },
  ];
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
  protected bindGroup: BindGroup;
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
      targets: [{ format: targetFormat, writeMask: ColorWriteMask.ALL }],
    });
    this.cameraBlock = new UniformBlock(device, { label: opts.label ? `${opts.label}-camera` : "camera", fields: CAMERA_FIELDS });
    this.modelBlock = new UniformBlock(device, { label: opts.label ? `${opts.label}-model` : "model", fields: MODEL_FIELDS });
    this.materialBlock = new UniformBlock(device, { label: opts.label ? `${opts.label}-material` : "material", fields: MATERIAL_FIELDS });
    this.bindGroup = this.createBindGroup();
  }

  /** 由子类提供 group 资源（含额外 texture/sampler）。 */
  protected abstract createBindGroup(): BindGroup;

  protected layoutOf(): BindGroupLayout {
    return this.layout;
  }

  /** 每帧开始时上传相机（viewProj/cameraPos）。 */
  beginFrame(viewProjection: Mat4, cameraPos?: Vec3): void {
    this.cameraBlock.setMat4("u_viewProj", viewProjection);
    this.cameraBlock.setVec4("u_cameraPos", cameraPos?.x ?? 0, cameraPos?.y ?? 0, cameraPos?.z ?? 0, 1);
    this.cameraBlock.flush();
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

/**
 * 纯色材质：diffuse 光照 + 可选颜色。
 */
export class ColorMaterial extends BaseMaterial {
  private readonly _color: Color;

  constructor(device: Device, color: Color, opts: MaterialOptions = {}) {
    const program = device.createProgram({
      label: opts.label ?? "unidraw-color-program",
      glsl: { vertex: VERTEX_GLSL, fragment: COLOR_FRAGMENT_GLSL },
      wgsl: { code: VERTEX_WGSL + COLOR_FRAGMENT_WGSL },
    });
    super(device, program, opts);
    this._color = color.clone();
    this.flushColor();
  }

  private flushColor(): void {
    this.materialBlock.setColor("u_color", this._color);
    this.materialBlock.flush();
  }

  get color(): Color {
    return this._color;
  }

  setColor(color: Color): this {
    this._color.copy(color);
    this.flushColor();
    return this;
  }

  protected override createBindGroup(): BindGroup {
    return this.device.createBindGroup({
      label: "colormaterial-group",
      layout: this.layout,
      entries: [
        { binding: 0, resource: this.cameraBlock.buffer },
        { binding: 1, resource: this.modelBlock.buffer },
        { binding: 2, resource: this.materialBlock.buffer },
      ],
    });
  }
}

export interface TextureMaterialOptions extends MaterialOptions {
  /** 纹理地址模式等采样参数 */
  sampler?: {
    addressModeU?: "clamp-to-edge" | "repeat" | "mirror-repeat";
    addressModeV?: "clamp-to-edge" | "repeat" | "mirror-repeat";
    magFilter?: "nearest" | "linear";
    minFilter?: "nearest" | "linear";
    mipmapFilter?: "nearest" | "linear";
  };
}

/**
 * 纹理材质：albedo 纹理 * 颜色。
 * 布局额外包含 binding 3（u_albedo）与 binding 4（u_albedoSampler）。
 */
export class TextureMaterial extends BaseMaterial {
  private _texture: Texture | null = null;
  private readonly _sampler: Sampler;
  private readonly _color: Color;

  constructor(device: Device, color: Color, opts: TextureMaterialOptions = {}) {
    const program = device.createProgram({
      label: opts.label ?? "unidraw-texture-program",
      glsl: { vertex: VERTEX_GLSL, fragment: TEXTURE_FRAGMENT_GLSL },
      wgsl: { code: VERTEX_WGSL + TEXTURE_FRAGMENT_WGSL },
    });
    super(device, program, opts, [
      { binding: 3, type: "texture", visibility: 2, name: "u_albedo" },
      { binding: 4, type: "sampler", visibility: 2, name: "u_albedoSampler" },
    ]);
    const s = opts.sampler ?? {};
    this._sampler = device.createSampler({
      label: opts.label ? `${opts.label}-sampler` : "texture-sampler",
      addressModeU: s.addressModeU ?? "repeat",
      addressModeV: s.addressModeV ?? "repeat",
      magFilter: s.magFilter ?? "linear",
      minFilter: s.minFilter ?? "linear",
      mipmapFilter: s.mipmapFilter ?? "nearest",
    });
    this._color = color.clone();
    this.flushColor();
    // 占位 BindGroup：无纹理时仅绑定 UBO（纹理绑定 3/4 缺省跳过）
    this.bindGroup = this.createBindGroup();
  }

  private flushColor(): void {
    this.materialBlock.setColor("u_color", this._color);
    this.materialBlock.flush();
  }

  get color(): Color {
    return this._color;
  }

  setColor(color: Color): this {
    this._color.copy(color);
    this.flushColor();
    return this;
  }

  /** 绑定纹理（会重建 BindGroup）。 */
  setTexture(texture: Texture): this {
    this._texture = texture;
    this.bindGroup = this.createBindGroup();
    return this;
  }

  get texture(): Texture | null {
    return this._texture;
  }

  protected override createBindGroup(): BindGroup {
    const entries: { binding: number; resource: unknown }[] = [
      { binding: 0, resource: this.cameraBlock.buffer },
      { binding: 1, resource: this.modelBlock.buffer },
      { binding: 2, resource: this.materialBlock.buffer },
    ];
    if (this._texture) {
      entries.push({ binding: 3, resource: this._texture.view() });
      entries.push({ binding: 4, resource: this._sampler });
    }
    return this.device.createBindGroup({
      label: "texturematerial-group",
      layout: this.layout,
      entries: entries as { binding: number; resource: import("../device/descriptors.js").BindGroupResource }[],
    });
  }
}
