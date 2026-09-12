import { UNLIT_FRAGMENT_GLSL, UNLIT_FRAGMENT_WGSL, VERTEX_GLSL, VERTEX_WGSL } from "./shaders.js";
import { BaseMaterial } from "./BaseMaterial.js";
/**
 * 无光照纯色材质：颜色原样输出（2D 平涂 / 自发光 / UI 等）。
 */
export class UnlitColorMaterial extends BaseMaterial {
    _color;
    constructor(device, color, opts = {}) {
        const program = device.createProgram({
            label: opts.label ?? "unidraw-unlit-program",
            glsl: { vertex: VERTEX_GLSL, fragment: UNLIT_FRAGMENT_GLSL },
            wgsl: { code: VERTEX_WGSL + UNLIT_FRAGMENT_WGSL },
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
            label: "unlit-group",
            layout: this.layout,
            entries: this.baseBindGroupEntries(),
        });
    }
}
//# sourceMappingURL=UnlitColorMaterial.js.map