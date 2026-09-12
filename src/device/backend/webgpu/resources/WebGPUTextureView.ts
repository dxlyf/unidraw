import { TextureView } from "../../../resources.js";
import { WebGPUTexture } from "./WebGPUTexture.js";

export class WebGPUTextureView extends TextureView {
  /**
   * 惰性创建 GPU 视图。
   *
   * - **默认视图**（`layerCount === null`）：维度要跟着纹理走 —— cube 纹理必须用
   *   `dimension: "cube"` 才能当立方体贴图采样，2D 数组要用 `"2d-array"` 才能一次
   *   采到所有层（WebGPU 默认视图是「单层 2d」）。
   * - **单层视图**（`viewLayer()`，`layerCount === 1`）：必须是 `dimension: "2d"` +
   *   `baseArrayLayer`，这样才能把某一层面当作渲染附件（cube 的一个面 = 一层）。
   */
  gpuView(): GPUTextureView {
    const tex = this.texture as WebGPUTexture;
    const dim = tex.dimension;
    if (this.layerCount !== null) {
      return tex.gpuTexture.createView({
        dimension: "2d",
        baseArrayLayer: this.baseArrayLayer,
        arrayLayerCount: this.layerCount,
        baseMipLevel: this.mipLevel,
        mipLevelCount: 1,
      });
    }
    if (this.mipLevel !== 0) {
      return tex.gpuTexture.createView({ baseMipLevel: this.mipLevel, mipLevelCount: 1 });
    }
    return tex.gpuTexture.createView({
      dimension: dim === "cube" ? "cube" : dim === "2d-array" ? "2d-array" : undefined,
    });
  }
}
