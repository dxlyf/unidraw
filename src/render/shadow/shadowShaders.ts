/**
 * 阴影相关的着色器片段。
 *
 * 1. **深度 pass**（把场景从光源视角画进阴影贴图）：只需要顶点阶段，
 *    fragment 为空（WebGPU 允许「无颜色附件 + 空 fragment」的管线）；
 * 2. **采样片段**（内置受光材质用）：`ShadowBlock` 声明 + 手动 PCF。
 *    深度比较**不用比较采样器**，而是 `texelFetch` / `textureLoad` 读深度值
 *    自己比 —— 两个后端语义完全一致，也不依赖任何扩展。
 */

import { MAX_SHADOW_MAPS } from "./constants.js";
import { SHADOW_BLOCK_BINDING, SHADOW_TEXTURE_BINDING } from "./ShadowState.js";

/** 深度 pass 的顶点着色器与内置材质共用（同一个顶点格式与 uniform 布局） */
export const SHADOW_DEPTH_FRAGMENT_GLSL = `#version 300 es
precision highp float;
// 只写深度：不需要任何输出（GLSL ES 3.00 允许零输出的片元着色器）
void main() {}
`;

/** 深度 pass 的 WGSL 片元阶段（无输入无输出） */
export const SHADOW_DEPTH_FRAGMENT_WGSL = `
@fragment
fn fs_main() {}
`;

/** GLSL：`ShadowBlock` + 阴影采样（含 3x3 PCF） */
export function shadowLookupGLSL(): string {
  const samplers = Array.from({ length: MAX_SHADOW_MAPS }, (_, i) => i)
    .map((i) => `uniform sampler2D u_shadowMap${i};`)
    .join("\n");
  const dispatch = Array.from({ length: MAX_SHADOW_MAPS }, (_, i) => i)
    .map((i) => `  if (m == ${i}) return unidrawShadowNine(u_shadowMap${i}, uv, refDepth, texel, radius);`)
    .join("\n");
  return `
layout(std140) uniform ShadowBlock {
  mat4 u_shadowMatrix[${MAX_SHADOW_MAPS}];   // 光源视投影
  vec4 u_shadowParams[${MAX_SHADOW_MAPS}];   // x 深度偏移 y 1/边长 z 类型 w 光源序号
  vec4 u_shadowParams2[${MAX_SHADOW_MAPS}];  // x PCF 半径(纹素) y 法线偏移
  vec4 u_shadowMeta;                         // x 有效贴图数量
};
${samplers}

/** 3x3 PCF：返回 [0,1] 的可见度（1 = 完全受光） */
float unidrawShadowNine(sampler2D map, vec2 uv, float refDepth, float texel, float radius) {
  float r = max(radius, 0.0);
  if (r <= 0.0) {
    float d = texelFetch(map, ivec2(uv * vec2(textureSize(map, 0))), 0).r;
    return refDepth <= d ? 1.0 : 0.0;
  }
  float sum = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y)) * texel * r;
      vec2 t = (uv + o) * vec2(textureSize(map, 0));
      float d = texelFetch(map, ivec2(t), 0).r;
      sum += refDepth <= d ? 1.0 : 0.0;
    }
  }
  return sum / 9.0;
}

float unidrawShadowMap(int m, vec2 uv, float refDepth, float texel, float radius) {
${dispatch}
  return 1.0;
}

/**
 * 阴影可见度：kind 0=方向光 1=聚光，lightIndex 是该类型内的序号。
 * 没有对应贴图时返回 1（完全受光）。
 */
float unidrawShadow(int kind, int lightIndex, vec3 worldPos, vec3 normal, float ndl) {
  int count = int(u_shadowMeta.x);
  for (int m = 0; m < ${MAX_SHADOW_MAPS}; m++) {
    if (m >= count) break;
    if (int(u_shadowParams[m].z + 0.5) != kind) continue;
    if (int(u_shadowParams[m].w + 0.5) != lightIndex) continue;
    vec3 offsetPos = worldPos + normal * u_shadowParams2[m].y;
    vec4 clip = u_shadowMatrix[m] * vec4(offsetPos, 1.0);
    if (clip.w <= 0.0) return 1.0;
    vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
    float ndcZ = clip.z / clip.w;              // ZO 投影：近平面 0，远平面 1
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;
    if (ndcZ <= 0.0 || ndcZ >= 1.0) return 1.0;
    // WebGL2/OpenGL 的窗口深度 = (z_ndc + 1) / 2（depth range [0,1]），
    // 而 WebGPU 直接存 z_ndc —— 这里显式换算，保证两端比较的是同一个量
    float windowZ = ndcZ * 0.5 + 0.5;
    // 斜率相关偏移：掠射角（ndl 小）时用更大的偏移，抑制自阴影条纹
    float bias = u_shadowParams[m].x * 0.5 * (1.0 + 2.0 * (1.0 - clamp(ndl, 0.0, 1.0)));
    return unidrawShadowMap(m, uv, windowZ - bias, u_shadowParams[m].y, u_shadowParams2[m].x);
  }
  return 1.0;
}
`;
}

/** WGSL：与 GLSL 版本逐项对应的阴影采样（注意 v 轴翻转） */
export function shadowLookupWGSL(): string {
  const textures = Array.from({ length: MAX_SHADOW_MAPS }, (_, i) => i)
    .map((i) => `@group(0) @binding(${SHADOW_TEXTURE_BINDING + i}) var u_shadowMap${i} : texture_depth_2d;`)
    .join("\n");
  const dispatch = Array.from({ length: MAX_SHADOW_MAPS }, (_, i) => i)
    .map((i) => `  if (m == ${i}) { return unidrawShadowNine(u_shadowMap${i}, uv, refDepth, texel, radius); }`)
    .join("\n");
  return `
struct ShadowBlock {
  u_shadowMatrix : array<mat4x4f, ${MAX_SHADOW_MAPS}>,
  u_shadowParams : array<vec4f, ${MAX_SHADOW_MAPS}>,
  u_shadowParams2 : array<vec4f, ${MAX_SHADOW_MAPS}>,
  u_shadowMeta : vec4f,
};
@group(0) @binding(${SHADOW_BLOCK_BINDING}) var<uniform> shadows : ShadowBlock;
${textures}

/** 3x3 PCF：返回 [0,1] 的可见度（1 = 完全受光） */
fn unidrawShadowNine(map : texture_depth_2d, uv : vec2f, refDepth : f32, texel : f32, radius : f32) -> f32 {
  let size = vec2f(textureDimensions(map, 0));
  let r = max(radius, 0.0);
  if (r <= 0.0) {
    // WebGPU 纹素原点在左上：v 轴翻转后再取整
    let t0 = vec2i(floor(vec2f(uv.x, 1.0 - uv.y) * size));
    return select(0.0, 1.0, refDepth <= textureLoad(map, t0, 0));
  }
  var sum = 0.0;
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let o = vec2f(f32(x), f32(y)) * texel * r;
      let t = vec2i(floor(vec2f(uv.x + o.x, 1.0 - (uv.y + o.y)) * size));
      sum = sum + select(0.0, 1.0, refDepth <= textureLoad(map, t, 0));
    }
  }
  return sum / 9.0;
}

fn unidrawShadowMap(m : i32, uv : vec2f, refDepth : f32, texel : f32, radius : f32) -> f32 {
${dispatch}
  return 1.0;
}

fn unidrawShadow(kind : i32, lightIndex : i32, worldPos : vec3f, normal : vec3f, ndl : f32) -> f32 {
  let count = i32(shadows.u_shadowMeta.x);
  for (var m = 0; m < ${MAX_SHADOW_MAPS}; m = m + 1) {
    if (m >= count) { break; }
    if (i32(shadows.u_shadowParams[m].z + 0.5) != kind) { continue; }
    if (i32(shadows.u_shadowParams[m].w + 0.5) != lightIndex) { continue; }
    let offsetPos = worldPos + normal * shadows.u_shadowParams2[m].y;
    let clip = shadows.u_shadowMatrix[m] * vec4f(offsetPos, 1.0);
    if (clip.w <= 0.0) { return 1.0; }
    let uv = clip.xy / clip.w * 0.5 + 0.5;
    let ndcZ = clip.z / clip.w;   // ZO 投影：近平面 0，远平面 1
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 1.0; }
    if (ndcZ <= 0.0 || ndcZ >= 1.0) { return 1.0; }
    // WebGPU 的深度纹理里存的就是 z_ndc（WebGL2 侧需要 *0.5+0.5，见 GLSL 版本）
    let bias = shadows.u_shadowParams[m].x * (1.0 + 2.0 * (1.0 - clamp(ndl, 0.0, 1.0)));
    return unidrawShadowMap(m, uv, ndcZ - bias, shadows.u_shadowParams[m].y, shadows.u_shadowParams2[m].x);
  }
  return 1.0;
}
`;
}

/** 阴影采样器 binding 名称（WebGL2 按「第 i 个纹理配第 i 个采样器」配对） */
export function shadowSamplerName(index: number): string {
  return `u_shadowSampler${index}`;
}

/** 阴影贴图纹理 binding 名称 */
export function shadowTextureName(index: number): string {
  return `u_shadowMap${index}`;
}
