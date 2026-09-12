import { ResourceBase } from "./ResourceBase.js";
import type { Texture } from "./Texture.js";

/**
 * 纹理视图。
 *
 * 除了「整幅」视图（默认）之外，还支持**取单层/单面**的视图（`Texture.viewLayer()`）：
 * 渲染附件要逐层写入（点光源 cube 阴影、纹理数组）时，用单层视图当附件；
 * `layerCount === null` 表示「按纹理维度取整幅」（2d-array/cube 的采样视图）。
 *
 * 命令层的 `view: null` 由后端解释为「当前画布」。
 */
export abstract class TextureView extends ResourceBase {
  readonly texture: Texture;
  /** 起始层（cube 纹理里就是面的序号） */
  readonly baseArrayLayer: number;
  /** 层数；`null` = 整幅（采样 cube / 2d-array 的默认视图） */
  readonly layerCount: number | null;
  readonly mipLevel: number;

  constructor(texture: Texture, baseArrayLayer = 0, layerCount: number | null = null, mipLevel = 0) {
    super(texture.label);
    this.texture = texture;
    this.baseArrayLayer = baseArrayLayer;
    this.layerCount = layerCount;
    this.mipLevel = mipLevel;
  }

  /** 视图不拥有底层纹理，销毁仅标记自身 */
  protected destroyNative(): void {}
}
