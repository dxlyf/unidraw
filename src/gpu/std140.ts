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

const SCALAR_SIZE: Record<UniformScalarType, number> = { f32: 4, i32: 4, u32: 4 };

export function typeSizeOf(type: UniformFieldType): number {
  switch (type) {
    case "f32":
    case "i32":
    case "u32":
      return SCALAR_SIZE[type];
    case "vec2":
      return 8;
    case "vec3":
      return 12;
    case "vec4":
      return 16;
    case "mat4":
      return 64;
  }
}

export function typeAlignOf(type: UniformFieldType): number {
  switch (type) {
    case "f32":
    case "i32":
    case "u32":
      return 4;
    case "vec2":
      return 8;
    case "vec3":
    case "vec4":
    case "mat4":
      return 16;
  }
}

function roundUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

export function std140Layout(fields: UniformField[]): Std140Layout {
  let offset = 0;
  let blockAlign = 1;
  const out: Std140Layout = { size: 0, align: 1, fields: [], byName: new Map() };

  for (const field of fields) {
    const count = field.count ?? 1;
    const elemSize = typeSizeOf(field.type);
    const elemAlign = typeAlignOf(field.type);
    const isArray = count > 1;

    // 数组：base alignment 提升到 16，元素 stride 为元素大小向上取整到 16（标量/向量）
    const align = isArray ? 16 : elemAlign;
    const stride = isArray ? roundUp(elemSize, 16) : 0;
    const memberSize = isArray ? stride * (count - 1) + elemSize : elemSize;

    offset = roundUp(offset, align);
    const layout: Std140FieldLayout = {
      name: field.name,
      type: field.type,
      count,
      offset,
      size: memberSize,
      stride,
      align,
    };
    out.fields.push(layout);
    out.byName.set(field.name, layout);
    offset += memberSize;
    blockAlign = Math.max(blockAlign, align);
  }

  out.align = blockAlign;
  out.size = roundUp(offset, blockAlign);
  return out;
}

/** 数组第 i 个元素偏移 */
export function arrayElementOffset(field: Std140FieldLayout, index: number): number {
  if (field.count <= 1) return field.offset;
  return field.offset + index * field.stride;
}
