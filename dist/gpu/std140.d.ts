/**
 * std140 统一布局引擎。
 *
 * 一套字段描述同时驱动：
 * - WebGL2 的 GLSL `layout(std140)` uniform block；
 * - WebGPU（WGSL uniform 地址空间的"标准 uniform 布局"）；
 * - CPU 侧 UBO 数据打包（避免逐字段 gl.uniform 调用）。
 *
 * 跨后端的数组仅推荐 vec4/mat4（元素 16 字节对齐、stride 天然 16 的倍数）。
 * 标量数组在 std140 下元素 stride 为 16（浪费），本引擎仍精确计算以便使用。
 */
export type UniformScalarType = "f32" | "i32" | "u32";
export type UniformVectorType = "vec2" | "vec3" | "vec4";
export type UniformMatrixType = "mat4";
export type UniformFieldType = UniformScalarType | UniformVectorType | UniformMatrixType;
export interface UniformField {
    name: string;
    type: UniformFieldType;
    /** >1 表示数组（仅 vec4/mat4 推荐跨后端使用） */
    count?: number;
}
export interface Std140FieldLayout {
    name: string;
    type: UniformFieldType;
    count: number;
    /** 字段起始偏移（字节） */
    offset: number;
    /** 字段实际字节大小 */
    size: number;
    /** 数组场景下的元素 stride（字节）；非数组为 0 */
    stride: number;
    align: number;
}
export interface Std140Layout {
    /** 整个 block 需要的字节数（已按最大对齐取整） */
    size: number;
    align: number;
    fields: Std140FieldLayout[];
    byName: Map<string, Std140FieldLayout>;
}
export declare function typeSizeOf(type: UniformFieldType): number;
export declare function typeAlignOf(type: UniformFieldType): number;
export declare function std140Layout(fields: UniformField[]): Std140Layout;
/** 数组第 i 个元素偏移 */
export declare function arrayElementOffset(field: Std140FieldLayout, index: number): number;
//# sourceMappingURL=std140.d.ts.map