import { COLOR_FRAGMENT_GLSL, COLOR_FRAGMENT_WGSL, VERTEX_GLSL, VERTEX_WGSL } from "./shaders.js";
import { BaseMaterial } from "./BaseMaterial.js";
/**
 * 纯色材质：diffuse 光照 + 可选颜色。
 */
export class ColorMaterial extends BaseMaterial {
    _color;
    constructor(device, color, opts = {}) {
        const program = device.createProgram({
            label: opts.label ?? "unidraw-color-program",
            glsl: { vertex: VERTEX_GLSL, fragment: COLOR_FRAGMENT_GLSL },
            wgsl: { code: VERTEX_WGSL + COLOR_FRAGMENT_WGSL },
        });
        super(device, program, opts);
        this._color = color.clone();
        this.flushColor();
        this.assembleBindGroup();
    }
    flushColor() {
        this.materialBlock.setColor("u_color", this._color);
        this.materialBlock.flush();
    }
    get color() {
        return this._color;
    }
    setColor(color) {
        this._color.copy(color);
        this.flushColor();
        return this;
    }
    createBindGroup() {
        return this.device.createBindGroup({
            label: "colormaterial-group",
            layout: this.layout,
            entries: this.baseBindGroupEntries(),
        });
    }
}
//# sourceMappingURL=ColorMaterial.js.map