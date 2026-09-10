import { Texture, TextureView } from "../../../resources.js";
import type { TextureDescriptor, TextureUploadOptions } from "../../../descriptors.js";
import { assert } from "../../../../util/assert.js";
import { textureFormatInfo } from "../../../../gpu/formats.js";
import { WebGPUDevice } from "../WebGPUDevice.js";
import { WebGPUTextureView } from "./WebGPUTextureView.js";
import { mapUsage } from "../gpuUtils.js";

export class WebGPUTexture extends Texture {
  readonly gpuTexture: GPUTexture;
  private readonly _device: WebGPUDevice;

  constructor(device: WebGPUDevice, desc: TextureDescriptor) {
    super(desc);
    this._device = device;
    this.gpuTexture = device.gpu.createTexture({
      label: desc.label,
      size: { width: desc.width, height: desc.height },
      format: desc.format as GPUTextureFormat,
      usage: mapUsage(desc.usage),
      mipLevelCount: desc.mipLevelCount ?? 1,
    });
    device.register(this);
  }

  protected override createDefaultView(): TextureView {
    return new WebGPUTextureView(this);
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
    let payload: ArrayBufferView = data;
    if (aligned !== bytesPerRow || data.byteOffset % 4 !== 0) {
      const copy = new Uint8Array(aligned * height);
      const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      for (let row = 0; row < height; row++) {
        copy.set(src.subarray(row * bytesPerRow, row * bytesPerRow + width * bpp), row * aligned);
      }
      payload = copy;
    }
    this._device.gpu.queue.writeTexture(
      { texture: this.gpuTexture, mipLevel: options.mipLevel ?? 0, origin: { x, y } },
      payload,
      { bytesPerRow: aligned, rowsPerImage: height },
      { width, height },
    );
  }

  override generateMipmaps(): void {
    // 简单场景：不做自动 mipmap（文档说明用法）
  }

  protected destroyNative(): void {
    this.gpuTexture.destroy();
  }
}
