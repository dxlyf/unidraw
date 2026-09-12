import type { TextureFormat, TextureUsageFlags } from "../../gpu/types.js";
import type { TextureDescriptor, TextureUploadOptions } from "../descriptors.js";
import type { TextureDimension } from "../../gpu/types.js";
import { assert } from "../../util/assert.js";
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
  /** 维度（默认 `"2d"`）；见 `TextureDescriptor.dimension` */
  readonly dimension: TextureDimension;
  /** 3D 深度 / 数组层数 / cube 的面数（cube 恒为 6） */
  readonly depthOrArrayLayers: number;
  /** 采样数（>1 = 多重采样附件；回读要读解析后的单采样纹理，不是它本身） */
  readonly sampleCount: number;
  private _view: TextureView | null = null;
  private readonly _layerViews = new Map<string, TextureView>();

  constructor(desc: TextureDescriptor) {
    super(desc.label);
    this.width = desc.width;
    this.height = desc.height;
    this.format = desc.format;
    this.usage = desc.usage;
    this.dimension = desc.dimension ?? "2d";
    this.depthOrArrayLayers = this.dimension === "cube" ? 6 : Math.max(1, Math.floor(desc.depthOrArrayLayers ?? 1));
    this.sampleCount = Math.max(1, Math.floor(desc.sampleCount ?? 1));
  }

  /** 获取默认视图（整幅：mip 0，采样 cube / 2d-array 时含全部层）。 */
  view(): TextureView {
    if (!this._view) this._view = this.createDefaultView();
    return this._view;
  }

  /**
   * 取**单层/单面**的视图（cube 纹理里 `layer` 就是面的序号 0..5）。
   *
   * 用于把某一层当作渲染附件（`RenderTarget` 的分层模式）或只采样某一层；
   * 2D 纹理上等价于 `view()`。结果按 `(layer, mipLevel)` 缓存。
   */
  viewLayer(layer = 0, mipLevel = 0): TextureView {
    const l = Math.max(0, Math.floor(layer));
    const m = Math.max(0, Math.floor(mipLevel));
    assert(l < this.depthOrArrayLayers, `viewLayer 层号越界：${l} >= ${this.depthOrArrayLayers}`);
    if (l === 0 && m === 0 && this.dimension === "2d") return this.view();
    const key = `${m}:${l}`;
    let v = this._layerViews.get(key);
    if (!v) {
      v = this.createLayerView(l, m);
      this._layerViews.set(key, v);
    }
    return v;
  }

  /** 后端实现：单层视图（`layerCount = 1`） */
  protected abstract createLayerView(baseArrayLayer: number, mipLevel: number): TextureView;

  protected abstract createDefaultView(): TextureView;

  /** 上传像素数据（支持子区域）。 */
  abstract upload(data: ArrayBufferView, options?: TextureUploadOptions): void;

  /** 生成 mipmap（WebGPU 需 COPY_SRC|COPY_DST；WebGL2 需 mipLevelCount>1）。 */
  abstract generateMipmaps(): void;

  override destroy(): void {
    if (this.destroyed) return;
    this._view?.destroy();
    this._view = null;
    for (const v of this._layerViews.values()) v.destroy();
    this._layerViews.clear();
    super.destroy();
  }
}
