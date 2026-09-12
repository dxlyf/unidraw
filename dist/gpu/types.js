/**
 * 后端无关的统一 GPU 类型定义。
 *
 * 设计目标：WebGL2 / WebGPU / Mock 三种后端共用同一套描述符与枚举，
 * 由各后端翻译为原生 API 状态。
 */
// ---------------------------------------------------------------------------
// 缓冲
// ---------------------------------------------------------------------------
export const BufferUsage = {
    VERTEX: 1 << 0,
    INDEX: 1 << 1,
    UNIFORM: 1 << 2,
    STORAGE: 1 << 3,
    INDIRECT: 1 << 4,
    COPY_SRC: 1 << 5,
    COPY_DST: 1 << 6,
};
// ---------------------------------------------------------------------------
// 纹理
// ---------------------------------------------------------------------------
export const TextureUsage = {
    COPY_SRC: 1 << 0,
    COPY_DST: 1 << 1,
    TEXTURE_BINDING: 1 << 2,
    STORAGE_BINDING: 1 << 3,
    RENDER_ATTACHMENT: 1 << 4,
};
// ---------------------------------------------------------------------------
// 可见性（预留给计算阶段扩展）
// ---------------------------------------------------------------------------
export const ShaderStage = {
    VERTEX: 1 << 0,
    FRAGMENT: 1 << 1,
    COMPUTE: 1 << 2,
};
/** 是否是 2D 纹理格式 */
export function isDepthFormat(format) {
    return format === "depth32float" || format === "depth24plus";
}
//# sourceMappingURL=types.js.map