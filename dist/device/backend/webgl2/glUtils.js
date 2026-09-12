import { assert, UnidrawError } from "../../../util/assert.js";
import { BufferUsage } from "../../../gpu/types.js";
// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
export function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    assert(shader, "无法创建 shader（上下文可能已丢失）");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new UnidrawError(`GLSL 编译失败：\n${log}`);
    }
    return shader;
}
export function bufferTarget(usage) {
    if (usage & BufferUsage.INDEX)
        return 0x8893; // ELEMENT_ARRAY_BUFFER
    if (usage & BufferUsage.UNIFORM)
        return 0x8a11; // UNIFORM_BUFFER
    if (usage & BufferUsage.STORAGE)
        return 0x90d2; // SHADER_STORAGE_BUFFER
    return 0x8892; // ARRAY_BUFFER
}
export function bufferUsageHint(usage) {
    const dynamic = BufferUsage.UNIFORM | BufferUsage.STORAGE | BufferUsage.COPY_DST;
    return usage & dynamic ? 0x88e8 : 0x88e4; // DYNAMIC_DRAW / STATIC_DRAW
}
/** 纹理格式 → GL 常量（有类型的安全映射） */
export function textureGLParams(gl, format) {
    switch (format) {
        case "r8unorm":
            return { internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE };
        case "rg8unorm":
            return { internal: gl.RG8, format: gl.RG, type: gl.UNSIGNED_BYTE };
        case "rgba8unorm":
            return { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
        case "rgba8unorm-srgb":
            return { internal: gl.SRGB8_ALPHA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
        case "r32float":
            return { internal: gl.R32F, format: gl.RED, type: gl.FLOAT };
        case "rgba16float":
            return { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
        case "rgba32float":
            return { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT };
        case "depth32float":
            return { internal: gl.DEPTH_COMPONENT32F, format: gl.DEPTH_COMPONENT, type: gl.FLOAT };
        case "depth24plus":
            return { internal: gl.DEPTH_COMPONENT24, format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_INT };
        default:
            throw new UnidrawError(`[unidraw] WebGL2 不支持的纹理格式：${format}`);
    }
}
export function attributeGLType(gl, glType) {
    switch (glType) {
        case "FLOAT":
            return gl.FLOAT;
        case "UNSIGNED_BYTE":
            return gl.UNSIGNED_BYTE;
        case "BYTE":
            return gl.BYTE;
        case "UNSIGNED_SHORT":
            return gl.UNSIGNED_SHORT;
        case "SHORT":
            return gl.SHORT;
    }
}
export function describeRenderer(gl) {
    try {
        const info = gl.getExtension("WEBGL_debug_renderer_info");
        const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : String(gl.getParameter(gl.RENDERER));
        return renderer || "unknown GPU";
    }
    catch {
        return "unknown GPU";
    }
}
//# sourceMappingURL=glUtils.js.map