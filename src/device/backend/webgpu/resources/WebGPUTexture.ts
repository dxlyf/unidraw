import { Texture, TextureView } from "../../../resources.js";
import type { TextureDescriptor, TextureUploadOptions } from "../../../descriptors.js";
import { assert } from "../../../../util/assert.js";
import { textureFormatInfo } from "../../../../gpu/formats.js";
import { TextureUsage } from "../../../../gpu/types.js";
import { WebGPUDevice } from "../WebGPUDevice.js";
import { WebGPUTextureView } from "./WebGPUTextureView.js";
import { mapUsage } from "../gpuUtils.js";

export class WebGPUTexture extends Texture {
  readonly gpuTexture: GPUTexture;
  private readonly _device: WebGPUDevice;

  constructor(device: WebGPUDevice, desc: TextureDescriptor) {
    super(desc);
    this._device = device;
    const sampleCount = Math.max(1, Math.floor(desc.sampleCount ?? 1));
    if (sampleCount > 1) {
      assert(desc.mipLevelCount === undefined || desc.mipLevelCount <= 1, "多采样纹理不能有 mip 链");
      assert(
        (desc.usage & (TextureUsage.TEXTURE_BINDING | TextureUsage.STORAGE_BINDING | TextureUsage.COPY_SRC)) === 0,
        "多采样纹理不能采样/拷贝，只能作为渲染附件（渲染结果请用 resolveTo 解析到普通纹理）",
      );
    }
    this.gpuTexture = device.gpu.createTexture({
      label: desc.label,
      // cube / 2d-array 在 WebGPU 里都是「2d + N 层」（cube 恒 6 层）；3d 才是真 3d
      size: { width: desc.width, height: desc.height, depthOrArrayLayers: this.depthOrArrayLayers },
      dimension: this.dimension === "3d" ? "3d" : "2d",
      format: desc.format as GPUTextureFormat,
      usage: mapUsage(desc.usage),
      mipLevelCount: desc.mipLevelCount ?? 1,
      sampleCount,
    });
    device.register(this);
  }

  protected override createDefaultView(): TextureView {
    return new WebGPUTextureView(this);
  }

  protected override createLayerView(baseArrayLayer: number, mipLevel: number): TextureView {
    return new WebGPUTextureView(this, baseArrayLayer, 1, mipLevel);
  }

  override upload(data: ArrayBufferView, options: TextureUploadOptions = {}): void {
    const info = textureFormatInfo(this.format);
    const x = options.x ?? 0;
    const y = options.y ?? 0;
    const width = options.width ?? this.width;
    const height = options.height ?? this.height;
    const bytesPerRow = options.bytesPerRow ?? width * info.bytesPerTexel;
    const bpp = info.bytesPerTexel;
    assert(width >= 1 && height >= 1 && x >= 0 && y >= 0, "upload 区域非法");
    assert(x + width <= this.width && y + height <= this.height, "upload 区域越界");

    // WebGPU 要求 bytesPerRow 为 256 的倍数 → 必要时做行填充拷贝
    const aligned = Math.ceil(bytesPerRow / 256) * 256;
    // 注意**多层**（3D / 2D 数组 / cube）：payload 要按层铺开，每层行数用 bytesPerImage
    // （缺省 bytesPerRow×height）算 —— 只按 height 分配会短一大截，WebGPU 直接报
    // “Required size for texture data layout (...) exceeds the linear data size”。
    const z = Math.max(0, Math.floor(options.z ?? 0));
    const depthLayers = Math.max(1, Math.floor(options.depth ?? 1));
    const rowsPerImage = Math.max(1, Math.round((options.bytesPerImage ?? bytesPerRow * height) / bytesPerRow));
    let payload: ArrayBufferView = data;
    if (aligned !== bytesPerRow || data.byteOffset % 4 !== 0 || depthLayers > 1) {
      const copy = new Uint8Array(aligned * rowsPerImage * depthLayers);
      const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      for (let layer = 0; layer < depthLayers; layer++) {
        for (let row = 0; row < height; row++) {
          const from = layer * rowsPerImage * bytesPerRow + row * bytesPerRow;
          copy.set(src.subarray(from, from + width * bpp), (layer * rowsPerImage + row) * aligned);
        }
      }
      payload = copy;
    }
    this._device.gpu.queue.writeTexture(
      { texture: this.gpuTexture, mipLevel: options.mipLevel ?? 0, origin: { x, y, z } },
      payload,
      { bytesPerRow: aligned, rowsPerImage },
      { width, height, depthOrArrayLayers: depthLayers },
    );
  }

  override generateMipmaps(): void {
    // 简单场景：不做自动 mipmap（文档说明用法）
  }

  protected destroyNative(): void {
    this.gpuTexture.destroy();
  }
}
