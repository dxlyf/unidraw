import { assert } from "../../util/assert.js";
import { ResourceBase } from "./ResourceBase.js";
/**
 * 2D 纹理句柄。
 */
export class Texture extends ResourceBase {
    width;
    height;
    format;
    usage;
    /** 维度（默认 `"2d"`）；见 `TextureDescriptor.dimension` */
    dimension;
    /** 3D 深度 / 数组层数 / cube 的面数（cube 恒为 6） */
    depthOrArrayLayers;
    /** 采样数（>1 = 多重采样附件；回读要读解析后的单采样纹理，不是它本身） */
    sampleCount;
    _view = null;
    _layerViews = new Map();
    constructor(desc) {
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
    view() {
        if (!this._view)
            this._view = this.createDefaultView();
        return this._view;
    }
    /**
     * 取**单层/单面**的视图（cube 纹理里 `layer` 就是面的序号 0..5）。
     *
     * 用于把某一层当作渲染附件（`RenderTarget` 的分层模式）或只采样某一层；
     * 2D 纹理上等价于 `view()`。结果按 `(layer, mipLevel)` 缓存。
     */
    viewLayer(layer = 0, mipLevel = 0) {
        const l = Math.max(0, Math.floor(layer));
        const m = Math.max(0, Math.floor(mipLevel));
        assert(l < this.depthOrArrayLayers, `viewLayer 层号越界：${l} >= ${this.depthOrArrayLayers}`);
        if (l === 0 && m === 0 && this.dimension === "2d")
            return this.view();
        const key = `${m}:${l}`;
        let v = this._layerViews.get(key);
        if (!v) {
            v = this.createLayerView(l, m);
            this._layerViews.set(key, v);
        }
        return v;
    }
    destroy() {
        if (this.destroyed)
            return;
        this._view?.destroy();
        this._view = null;
        for (const v of this._layerViews.values())
            v.destroy();
        this._layerViews.clear();
        super.destroy();
    }
}
//# sourceMappingURL=Texture.js.map