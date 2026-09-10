import { Texture, TextureView } from "../../../resources.js";
import { WebGPUTexture } from "./WebGPUTexture.js";

export class WebGPUTextureView extends TextureView {
  constructor(texture: Texture) {
    super(texture);
  }

  /** 惰性创建 GPU 视图。 */
  gpuView(): GPUTextureView {
    return (this.texture as WebGPUTexture).gpuTexture.createView();
  }
}
