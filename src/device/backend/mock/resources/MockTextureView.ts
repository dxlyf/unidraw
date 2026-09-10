import { Texture, TextureView } from "../../../resources.js";

export class MockTextureView extends TextureView {
  constructor(texture: Texture) {
    super(texture);
  }
}
