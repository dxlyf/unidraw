import { ResourceBase } from "./ResourceBase.js";
import type { Texture } from "./Texture.js";

/**
 * 纹理视图：v1 仅支持整幅 2D（mip 0, layer 0）。
 * 命令层的 `view: null` 由后端解释为「当前画布」。
 */
export abstract class TextureView extends ResourceBase {
  readonly texture: Texture;

  constructor(texture: Texture) {
    super(texture.label);
    this.texture = texture;
  }

  /** 视图不拥有底层纹理，销毁仅标记自身 */
  protected destroyNative(): void {}
}
