import type { Device } from "../device/Device.js";
import type { BindGroup } from "../device/resources.js";
import type { Color } from "../math/color.js";
import type { MaterialOptions } from "./BaseMaterial.js";
import { BaseMaterial } from "./BaseMaterial.js";
/**
 * 纯色材质：diffuse 光照 + 可选颜色。
 */
export declare class ColorMaterial extends BaseMaterial {
    private readonly _color;
    constructor(device: Device, color: Color, opts?: MaterialOptions);
    private flushColor;
    get color(): Color;
    setColor(color: Color): this;
    protected createBindGroup(): BindGroup;
}
//# sourceMappingURL=ColorMaterial.d.ts.map