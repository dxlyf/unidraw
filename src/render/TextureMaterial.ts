import type { Device } from "../device/Device.js";
import type { BindGroup, Texture } from "../device/resources.js";
import type { Sampler } from "../device/resources.js";
import { TextureUsage } from "../gpu/types.js";
import type { Color } from "../math/color.js";
import { TEXTURE_FRAGMENT_GLSL, TEXTURE_FRAGMENT_WGSL, VERTEX_GLSL, VERTEX_WGSL } from "./shaders.js";
import type { MaterialOptions } from "./BaseMaterial.js";
import { BaseMaterial } from "./BaseMaterial.js";

export interface TextureMaterialOptions extends MaterialOptions {
  /** 纹理地址模式等采样参数 */
  sampler?: {
    addressModeU?: "clamp-to-edge" | "repeat" | "mirror-repeat";
    addressModeV?: "clamp-to-edge" | "repeat" | "mirror-repeat";
    magFilter?: "nearest" | "linear";
    minFilter?: "nearest" | "linear";
    mipmapFilter?: "nearest" | "linear";
    /** 启用 mipmap 过滤（需要纹理生成完整 mip 链）；默认 false */
    mips?: boolean;
  };
}


/**
 * 纹理材质：albedo 纹理 * 颜色。
 * 布局：0/1/2 标准块，3 = LightsBlock（基类），4 = u_albedo，5 = u_albedoSampler。
 */
export class TextureMaterial extends BaseMaterial {
  private _texture: Texture;
  private readonly _sampler: Sampler;
  private readonly _color: Color;

  constructor(device: Device, color: Color, opts: TextureMaterialOptions = {}) {
    const program = device.createProgram({
      label: opts.label ?? "unidraw-texture-program",
      glsl: { vertex: VERTEX_GLSL, fragment: TEXTURE_FRAGMENT_GLSL },
      wgsl: { code: VERTEX_WGSL + TEXTURE_FRAGMENT_WGSL },
    });
    super(device, program, opts, [
      { binding: 4, type: "texture", visibility: 2, name: "u_albedo" },
      { binding: 5, type: "sampler", visibility: 2, name: "u_albedoSampler" },
    ]);
    const s = opts.sampler ?? {};
    this._sampler = device.createSampler({
      label: opts.label ? `${opts.label}-sampler` : "texture-sampler",
      addressModeU: s.addressModeU ?? "repeat",
      addressModeV: s.addressModeV ?? "repeat",
      magFilter: s.magFilter ?? "linear",
      minFilter: s.minFilter ?? "linear",
      mipmapFilter: s.mipmapFilter ?? "nearest",
      mips: s.mips ?? false,
    });
    // 缺省用 1x1 白色占位纹理（纯色 tint），保证 bind group 覆盖全部 binding
    this._texture = TextureMaterial.createPlaceholderTexture(device, opts.label ? `${opts.label}-placeholder` : "texture-placeholder");
    this._color = color.clone();
    this.flushColor();
    this.assembleBindGroup();
  }

  private static createPlaceholderTexture(device: Device, label: string): Texture {
    const t = device.createTexture({ label, width: 1, height: 1, format: "rgba8unorm", usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST });
    t.upload(new Uint8Array([255, 255, 255, 255]));
    return t;
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
    this.assembleBindGroup();
    return this;
  }

  get texture(): Texture {
    return this._texture;
  }

  protected override createBindGroup(): BindGroup {
    return this.device.createBindGroup({
      label: "texturematerial-group",
      layout: this.layout,
      entries: [
        ...this.baseBindGroupEntries(),
        { binding: 4, resource: this._texture.view() },
        { binding: 5, resource: this._sampler },
      ],
    });
  }
}
