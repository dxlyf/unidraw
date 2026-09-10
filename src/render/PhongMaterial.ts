import type { Device } from "../device/Device.js";
import type { BindGroup } from "../device/resources.js";
import type { Color } from "../math/color.js";
import { PHONG_FRAGMENT_GLSL, PHONG_FRAGMENT_WGSL, VERTEX_GLSL, VERTEX_WGSL } from "./shaders.js";
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
export class PhongMaterial extends BaseMaterial {
  private readonly _color: Color;
  private shininess: number;
  private specular: number;
  private ambient: number;

  constructor(device: Device, color: Color, opts: PhongMaterialOptions = {}) {
    const program = device.createProgram({
      label: opts.label ?? "unidraw-phong-program",
      glsl: { vertex: VERTEX_GLSL, fragment: PHONG_FRAGMENT_GLSL },
      wgsl: { code: VERTEX_WGSL + PHONG_FRAGMENT_WGSL },
    });
    super(device, program, opts);
    this._color = color.clone();
    this.shininess = opts.shininess ?? 48;
    this.specular = opts.specular ?? 0.7;
    this.ambient = opts.ambient ?? 0.18;
    this.flushMaterial();
    this.assembleBindGroup();
  }

  private flushMaterial(): void {
    this.materialBlock.setColor("u_color", this._color);
    this.materialBlock.setVec4("u_params", this.shininess, this.specular, this.ambient, 0);
    this.materialBlock.flush();
  }

  get color(): Color {
    return this._color;
  }

  setColor(color: Color): this {
    this._color.copy(color);
    this.flushMaterial();
    return this;
  }

  setShininess(v: number): this {
    this.shininess = Math.max(1, v);
    this.flushMaterial();
    return this;
  }

  setSpecular(v: number): this {
    this.specular = Math.max(0, v);
    this.flushMaterial();
    return this;
  }

  setAmbient(v: number): this {
    this.ambient = Math.max(0, Math.min(1, v));
    this.flushMaterial();
    return this;
  }

  protected override createBindGroup(): BindGroup {
    return this.device.createBindGroup({
      label: "phong-group",
      layout: this.layout,
      entries: this.baseBindGroupEntries(),
    });
  }
}
