import { BindGroupLayout } from "../../../resources.js";
import type { BindGroupLayoutDescriptor } from "../../../descriptors.js";
import { WebGL2Device } from "../WebGL2Device.js";

export class GLBindGroupLayout extends BindGroupLayout {
  /** uniform-buffer entry 的 binding point（数组与 layout 中 UBO entry 顺序对齐） */
  readonly uboPoints: number[];
  /** texture entry 的纹理单元（与 texture entry 顺序对齐） */
  readonly textureUnits: number[];
  private readonly _device: WebGL2Device;

  constructor(device: WebGL2Device, desc: BindGroupLayoutDescriptor) {
    super(desc);
    this._device = device;
    const ubo: number[] = [];
    const units: number[] = [];
    for (const entry of desc.entries) {
      if (entry.type === "uniform-buffer") ubo.push(device.allocateUniformBinding());
      else if (entry.type === "texture") units.push(device.allocateTextureUnit());
    }
    this.uboPoints = ubo;
    this.textureUnits = units;
    device.register(this);
  }

  protected destroyNative(): void {
    // 归还 binding point / 纹理单元，并让其失效的缓存项可被重新分配
    for (const point of this.uboPoints) this._device.freeUniformBinding(point);
    for (const unit of this.textureUnits) this._device.freeTextureUnit(unit);
    this._device.dropLayoutCache(this);
  }
}
