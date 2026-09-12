import { Program } from "../../../resources.js";
import { assert, UnidrawError } from "../../../../util/assert.js";
import { compileShader } from "../glUtils.js";
export class GLProgram extends Program {
    gl;
    _program = null;
    _locations = new Map();
    _blockIndex = new Map();
    constructor(device, desc) {
        super(desc);
        this.gl = device.gl;
        device.register(this);
    }
    /** 延迟链接，链接后缓存 uniform/UBO 信息。 */
    linkedProgram() {
        if (this._program)
            return this._program;
        assert(this.supportsWebGL2, `program("${this.label}") 缺少 glsl 源码，无法在 WebGL2 后端使用`);
        const gl = this.gl;
        const src = this.descriptor.glsl;
        const vs = compileShader(gl, gl.VERTEX_SHADER, src.vertex);
        const fs = compileShader(gl, gl.FRAGMENT_SHADER, src.fragment);
        const prog = gl.createProgram();
        assert(prog, "createProgram 失败");
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(prog);
            gl.deleteProgram(prog);
            throw new UnidrawError(`GLSL 链接失败：\n${log}`);
        }
        this._program = prog;
        const uniforms = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < uniforms; i++) {
            const info = gl.getActiveUniform(prog, i);
            if (!info)
                continue;
            this._locations.set(info.name, gl.getUniformLocation(prog, info.name));
        }
        const blocks = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORM_BLOCKS);
        for (let i = 0; i < blocks; i++) {
            const name = gl.getActiveUniformBlockName(prog, i);
            if (name)
                this._blockIndex.set(name, i);
        }
        return prog;
    }
    uniformLocation(name) {
        if (this._locations.has(name))
            return this._locations.get(name) ?? null;
        const prog = this._program;
        if (!prog)
            return null;
        const loc = this.gl.getUniformLocation(prog, name);
        this._locations.set(name, loc);
        return loc;
    }
    bindUniformBlock(name, point) {
        const idx = this._blockIndex.get(name);
        if (idx === undefined || !this._program)
            return;
        this.gl.uniformBlockBinding(this._program, idx, point);
    }
    destroyNative() {
        if (this._program)
            this.gl.deleteProgram(this._program);
        this._program = null;
    }
}
//# sourceMappingURL=GLProgram.js.map