import { BindGroupLayout } from "../../../resources.js";
export class GLBindGroupLayout extends BindGroupLayout {
    /** uniform-buffer entry 的 binding point（数组与 layout 中 UBO entry 顺序对齐） */
    uboPoints;
    /** texture entry 的纹理单元（与 texture entry 顺序对齐） */
    textureUnits;
    _device;
    constructor(device, desc) {
        super(desc);
        this._device = device;
        const ubo = [];
        const units = [];
        for (const entry of desc.entries) {
            if (entry.type === "uniform-buffer")
                ubo.push(device.allocateUniformBinding());
            else if (entry.type === "texture")
                units.push(device.allocateTextureUnit());
        }
        this.uboPoints = ubo;
        this.textureUnits = units;
        device.register(this);
    }
    destroyNative() {
        // 归还 binding point / 纹理单元，并让其失效的缓存项可被重新分配
        for (const point of this.uboPoints)
            this._device.freeUniformBinding(point);
        for (const unit of this.textureUnits)
            this._device.freeTextureUnit(unit);
        this._device.dropLayoutCache(this);
    }
}
//# sourceMappingURL=GLBindGroupLayout.js.map