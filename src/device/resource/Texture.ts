import type { TextureFormat, TextureUsageFlags } from "../../gpu/types.js";
import type { TextureDescriptor, TextureUploadOptions } from "../descriptors.js";
import { ResourceBase } from "./ResourceBase.js";
import type { TextureView } from "./TextureView.js";

/**
 * 2D 纹理句柄。
 */
export abstract class Texture extends ResourceBase {
  readonly width: number;
  readonly height: number;
  readonly format: TextureFormat;
  readonly usage: TextureUsageFlags;
  private _view: TextureView | null = null;

  constructor(desc: TextureDescriptor) {
    super(desc.label);
    this.width = desc.width;
    this.height = desc.height;
    this.format = desc.format;
    this.usage = desc.usage;
  }

  /** 获取默认视图（mip 0 / layer 0）。 */
  view(): TextureView {
    if (!this._view) this._view = this.createDefaultView();
    return this._view;
  }

  protected abstract createDefaultView(): TextureView;

  /** 上传像素数据（支持子区域）。 */
  abstract upload(data: ArrayBufferView, options?: TextureUploadOptions): void;

  /** 生成 mipmap（WebGPU 需 COPY_SRC|COPY_DST；WebGL2 需 mipLevelCount>1）。 */
  abstract generateMipmaps(): void;

  override destroy(): void {
    if (this.destroyed) return;
    this._view?.destroy();
    this._view = null;
    super.destroy();
  }
}
