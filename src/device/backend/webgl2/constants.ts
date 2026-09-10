import type { BlendFactor, BlendOperation, CompareFunction, IndexFormat } from "../../../gpu/types.js";


// ---------------------------------------------------------------------------
// 常量表
// ---------------------------------------------------------------------------
export const GL_CONST = {
  DEPTH_TEST: 0x0b71,
  CULL_FACE: 0x0b44,
  BLEND: 0x0be2,
  SCISSOR_TEST: 0x0c11,
  CCW: 0x0901,
  CW: 0x0900,
  FRONT: 0x0404,
  BACK: 0x0405,
  POINTS: 0x0000,
  LINES: 0x0001,
  LINE_STRIP: 0x0003,
  TRIANGLES: 0x0004,
  TRIANGLE_STRIP: 0x0005,
  FUNC_ADD: 0x8006,
  FUNC_SUBTRACT: 0x800a,
  FUNC_REVERSE_SUBTRACT: 0x800b,
  MIN: 0x8007,
  MAX: 0x8008,
  ZERO: 0,
  ONE: 1,
  SRC_COLOR: 0x0302,
  ONE_MINUS_SRC_COLOR: 0x0303,
  SRC_ALPHA: 0x0302,
  ONE_MINUS_SRC_ALPHA: 0x0303,
  DST_COLOR: 0x0306,
  ONE_MINUS_DST_COLOR: 0x0307,
  DST_ALPHA: 0x0306,
  ONE_MINUS_DST_ALPHA: 0x0307,
  SRC_ALPHA_SATURATE: 0x0308,
  CONSTANT_COLOR: 0x8001,
  ONE_MINUS_CONSTANT_COLOR: 0x8002,
} as const;

export const BLEND_FACTORS: Record<BlendFactor, number> = {
  zero: GL_CONST.ZERO,
  one: GL_CONST.ONE,
  src: GL_CONST.SRC_COLOR,
  "one-minus-src": GL_CONST.ONE_MINUS_SRC_COLOR,
  "src-alpha": GL_CONST.SRC_ALPHA,
  "one-minus-src-alpha": GL_CONST.ONE_MINUS_SRC_ALPHA,
  dst: GL_CONST.DST_COLOR,
  "one-minus-dst": GL_CONST.ONE_MINUS_DST_COLOR,
  "dst-alpha": GL_CONST.DST_ALPHA,
  "one-minus-dst-alpha": GL_CONST.ONE_MINUS_DST_ALPHA,
  "src-alpha-saturated": GL_CONST.SRC_ALPHA_SATURATE,
  constant: GL_CONST.CONSTANT_COLOR,
  "one-minus-constant": GL_CONST.ONE_MINUS_CONSTANT_COLOR,
};

export const BLEND_OPS: Record<BlendOperation, number> = {
  add: GL_CONST.FUNC_ADD,
  subtract: GL_CONST.FUNC_SUBTRACT,
  "reverse-subtract": GL_CONST.FUNC_REVERSE_SUBTRACT,
  min: GL_CONST.MIN,
  max: GL_CONST.MAX,
};

export const COMPARE: Record<CompareFunction, number> = {
  never: 0x0200,
  less: 0x0201,
  equal: 0x0202,
  "less-equal": 0x0203,
  greater: 0x0204,
  "not-equal": 0x0205,
  "greater-equal": 0x0206,
  always: 0x0207,
};

export const INDEX_TYPES: Record<IndexFormat, number> = {
  uint16: 0x1403,
  uint32: 0x1405,
};

export const TOPOLOGY_GL: Record<string, number> = {
  "point-list": GL_CONST.POINTS,
  "line-list": GL_CONST.LINES,
  "line-strip": GL_CONST.LINE_STRIP,
  "triangle-list": GL_CONST.TRIANGLES,
  "triangle-strip": GL_CONST.TRIANGLE_STRIP,
};

export let nextResourceId = 1;

export function nextId(): number {
  return nextResourceId++;
}
