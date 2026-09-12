import type { Device } from "../device/Device.js";
import type { BindGroup } from "../device/resources.js";
import type { Color } from "../math/color.js";
import type { MaterialOptions } from "./BaseMaterial.js";
import { BaseMaterial } from "./BaseMaterial.js";
/**
 * 无光照纯色材质：颜色原样输出（2D 平涂 / 自发光 / UI 等）。
 */
export declare class UnlitColorMaterial extends BaseMaterial {
    private readonly _color;
    constructor(device: Device, color: Color, opts?: MaterialOptions);
    private flushColor;
    get color(): Color;
    setColor(color: Color): this;
    protected createBindGroup(): BindGroup;
}
//# sourceMappingURL=UnlitColorMaterial.d.ts.map