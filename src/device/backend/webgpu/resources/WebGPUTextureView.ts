import { Texture, TextureView } from "../../../resources.js";
import { WebGPUTexture } from "./WebGPUTexture.js";

export class WebGPUTextureView extends TextureView {
  constructor(texture: Texture) {
    super(texture);
  }

  /**
   * 惰性创建 GPU 视图。
   *
   * 维度要跟着纹理走：cube 纹理必须用 `dimension: "cube"` 的视图才能当立方体贴图采样，
   * 2D 数组要用 `"2d-array"` 才能一次采到所有层（WebGPU 默认视图是「单层 2d」）。
   */
  gpuView(): GPUTextureView {
    const dim = this.texture.dimension;
    return (this.texture as WebGPUTexture).gpuTexture.createView({
      dimension: dim === "cube" ? "cube" : dim === "2d-array" ? "2d-array" : undefined,
    });
  }
}
