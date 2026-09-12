import type { IndexFormat, TextureFormat, VertexFormat } from "./types.js";
/**
 * 顶点格式元信息：同一份描述被翻译到 WebGL2（gl.vertexAttribPointer）
 * 与 WebGPU（vertex attribute format）。
 */
export interface VertexFormatInfo {
    /** 单个元素字节数 */
    size: number;
    /** 分量数 */
    components: number;
    /** WebGL2 数据类型常量名（用于转换表 gl[type]） */
    glType: "FLOAT" | "UNSIGNED_BYTE" | "BYTE" | "UNSIGNED_SHORT" | "SHORT";
    /** WebGL2 是否归一化 */
    normalized: boolean;
    /** WebGPU 顶点格式字符串 */
    wgslFormat: string;
    /** 是否整数类型 */
    integer: boolean;
}
export declare function vertexFormatInfo(format: VertexFormat): VertexFormatInfo;
export declare const INDEX_FORMAT_BYTES: Record<IndexFormat, number>;
export interface TextureFormatInfo {
    /** 每纹素字节数（未压缩） */
    bytesPerTexel: number;
    /** 分量数 */
    channels: number;
    /** 是否深度格式 */
    depth: boolean;
    /** WebGL2 内部格式常量名 */
    glInternal: string;
    /** WebGL2 像素格式常量名 */
    glFormat: string;
    /** WebGL2 像素类型常量名 */
    glType: string;
}
export declare function textureFormatInfo(format: TextureFormat): TextureFormatInfo;
//# sourceMappingURL=formats.d.ts.map