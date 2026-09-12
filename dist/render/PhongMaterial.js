import { PHONG_FRAGMENT_GLSL, PHONG_FRAGMENT_WGSL, VERTEX_GLSL, VERTEX_WGSL } from "./shaders.js";
import { BaseMaterial } from "./BaseMaterial.js";
/**
 * Blinn-Phong 材质：diffuse + 镜面高光（白色高光）。绘制前请用
 * `beginFrame(vp, camera.eyePosition)` 传入相机位置。
 */
export class PhongMaterial extends BaseMaterial {
    _color;
    shininess;
    specular;
    ambient;
    constructor(device, color, opts = {}) {
        const program = device.createProgram({
            label: opts.label ?? "unidraw-phong-program",
            glsl: { vertex: VERTEX_GLSL, fragment: PHONG_FRAGMENT_GLSL },
            wgsl: { code: VERTEX_WGSL + PHONG_FRAGMENT_WGSL },
        });
        super(device, program, opts);
        this._color = color.clone();
        this.shininess = opts.shininess ?? 48;
        this.specular = opts.specular ?? 0.7;
        this.ambient = opts.ambient ?? 0.18;
        this.flushMaterial();
        this.assembleBindGroup();
    }
    flushMaterial() {
        this.materialBlock.setColor("u_color", this._color);
        this.materialBlock.setVec4("u_params", this.shininess, this.specular, this.ambient, 0);
        this.materialBlock.flush();
    }
    get color() {
        return this._color;
    }
    setColor(color) {
        this._color.copy(color);
        this.flushMaterial();
        return this;
    }
    setShininess(v) {
        this.shininess = Math.max(1, v);
        this.flushMaterial();
        return this;
    }
    setSpecular(v) {
        this.specular = Math.max(0, v);
        this.flushMaterial();
        return this;
    }
    setAmbient(v) {
        this.ambient = Math.max(0, Math.min(1, v));
        this.flushMaterial();
        return this;
    }
    createBindGroup() {
        return this.device.createBindGroup({
            label: "phong-group",
            layout: this.layout,
            entries: this.baseBindGroupEntries(),
        });
    }
}
//# sourceMappingURL=PhongMaterial.js.map