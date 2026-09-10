import type { Device } from "../device/Device.js";
import type { BindGroup } from "../device/resources.js";
import type { Color } from "../math/color.js";
import { COLOR_FRAGMENT_GLSL, COLOR_FRAGMENT_WGSL, VERTEX_GLSL, VERTEX_WGSL } from "./shaders.js";
import type { MaterialOptions } from "./BaseMaterial.js";
import { BaseMaterial } from "./BaseMaterial.js";


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
    this.assembleBindGroup();
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
