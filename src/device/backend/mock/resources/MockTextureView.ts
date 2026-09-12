import { Texture, TextureView } from "../../../resources.js";

export class MockTextureView extends TextureView {
  constructor(texture: Texture, baseArrayLayer = 0, layerCount: number | null = null, mipLevel = 0) {
    super(texture, baseArrayLayer, layerCount, mipLevel);
  }
}
