import type { Device } from "../device/Device.js";
import type { BindGroup } from "../device/resources.js";
import type { Color } from "../math/color.js";
import { UNLIT_FRAGMENT_GLSL, UNLIT_FRAGMENT_WGSL, VERTEX_GLSL, VERTEX_WGSL } from "./shaders.js";
import type { MaterialOptions } from "./BaseMaterial.js";
import { BaseMaterial } from "./BaseMaterial.js";


/**
 * 无光照纯色材质：颜色原样输出（2D 平涂 / 自发光 / UI 等）。
 */
export class UnlitColorMaterial extends BaseMaterial {
  private readonly _color: Color;

  constructor(device: Device, color: Color, opts: MaterialOptions = {}) {
    const program = device.createProgram({
      label: opts.label ?? "unidraw-unlit-program",
      glsl: { vertex: VERTEX_GLSL, fragment: UNLIT_FRAGMENT_GLSL },
      wgsl: { code: VERTEX_WGSL + UNLIT_FRAGMENT_WGSL },
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
      label: "unlit-group",
      layout: this.layout,
      entries: [
        { binding: 0, resource: this.cameraBlock.buffer },
        { binding: 1, resource: this.modelBlock.buffer },
        { binding: 2, resource: this.materialBlock.buffer },
      ],
    });
  }
}
