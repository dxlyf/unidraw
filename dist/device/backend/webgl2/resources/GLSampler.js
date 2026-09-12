import { Sampler } from "../../../resources.js";
import { assert } from "../../../../util/assert.js";
import { nextId } from "../constants.js";
export class GLSampler extends Sampler {
    glSampler;
    gl;
    id = nextId();
    constructor(device, desc) {
        super(desc);
        this.gl = device.gl;
        const s = this.gl.createSampler();
        assert(s, "createSampler 失败");
        this.glSampler = s;
        const d = this.descriptor;
        this.gl.samplerParameteri(s, this.gl.TEXTURE_MIN_FILTER, this.minFilterGL(d.minFilter ?? "linear", d.mipmapFilter ?? "linear", d.mips ?? false));
        this.gl.samplerParameteri(s, this.gl.TEXTURE_MAG_FILTER, (d.magFilter ?? "linear") === "nearest" ? this.gl.NEAREST : this.gl.LINEAR);
        this.gl.samplerParameteri(s, this.gl.TEXTURE_WRAP_S, this.wrapGL(d.addressModeU ?? "clamp-to-edge"));
        this.gl.samplerParameteri(s, this.gl.TEXTURE_WRAP_T, this.wrapGL(d.addressModeV ?? "clamp-to-edge"));
        this.gl.samplerParameteri(s, this.gl.TEXTURE_WRAP_R, this.wrapGL(d.addressModeW ?? "clamp-to-edge"));
        device.register(this);
    }
    /**
     * 仅当显式要求 mips 时才使用 mip 变体过滤；
     * 否则用非 mip 的 NEAREST/LINEAR，保证只有 base level 的纹理是“完整”的。
     */
    minFilterGL(min, mip, mips) {
        if (!mips)
            return min === "nearest" ? this.gl.NEAREST : this.gl.LINEAR;
        if (min === "nearest")
            return mip === "nearest" ? this.gl.NEAREST_MIPMAP_NEAREST : this.gl.NEAREST_MIPMAP_LINEAR;
        return mip === "nearest" ? this.gl.LINEAR_MIPMAP_NEAREST : this.gl.LINEAR_MIPMAP_LINEAR;
    }
    wrapGL(mode) {
        if (mode === "repeat")
            return this.gl.REPEAT;
        if (mode === "mirror-repeat")
            return this.gl.MIRRORED_REPEAT;
        return this.gl.CLAMP_TO_EDGE;
    }
    destroyNative() {
        this.gl.deleteSampler(this.glSampler);
    }
}
//# sourceMappingURL=GLSampler.js.map