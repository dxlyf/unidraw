/**
 * 阴影相关的着色器片段。
 *
 * 1. **深度 pass**：只需要顶点阶段，fragment 为空（WebGPU 允许「无颜色附件 + 空 fragment」）；
 * 2. **采样片段**：`ShadowBlock` 声明 + 手动 PCF。
 *
 * 深度比较**不用比较采样器**，而是 `texelFetch` / `textureLoad` 读深度值自己比 ——
 * 两个后端语义完全一致，也不依赖任何扩展。
 *
 * 每张贴图打包 4 个参数（见 `ShadowState`）：
 * ```
 * u_shadowParams[m]  = (bias, 1/mapSize, 类型, 光源序号)     bias 已换算成归一化深度
 * u_shadowParams2[m] = (PCF 半径(纹素), 法线偏移(世界), 滤波方式, 阴影强度)
 * ```
 * 其中滤波方式 0=硬边 / 1=3x3 / 2=5x5，强度 0..1 会按 `mix(1, visibility, intensity)` 生效。
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

/** GLSL：`ShadowBlock` + 阴影采样（硬边 / 3x3 / 5x5 PCF） */
export function shadowLookupGLSL(): string {
  const samplers = Array.from({ length: MAX_SHADOW_MAPS }, (_, i) => i)
    .map((i) => `uniform sampler2D u_shadowMap${i};`)
    .join("\n");
  const dispatch = Array.from({ length: MAX_SHADOW_MAPS }, (_, i) => i)
    .map((i) => `  if (m == ${i}) return unidrawShadowSample(u_shadowMap${i}, uv, refDepth, texel, radius, filterCode);`)
    .join("\n");
  return `
layout(std140) uniform ShadowBlock {
  mat4 u_shadowMatrix[${MAX_SHADOW_MAPS}];   // 光源视投影
  vec4 u_shadowParams[${MAX_SHADOW_MAPS}];   // x 深度偏移 y 1/边长 z 类型 w 光源序号
  vec4 u_shadowParams2[${MAX_SHADOW_MAPS}];  // x PCF 半径 y 法线偏移 z 滤波方式 w 强度
  vec4 u_shadowMeta;                         // x 有效贴图数量
};
${samplers}

float unidrawShadowTexel(sampler2D map, vec2 uv, float refDepth) {
  vec2 size = vec2(textureSize(map, 0));
  return refDepth <= texelFetch(map, ivec2(uv * size), 0).r ? 1.0 : 0.0;
}

/**
 * 采样一张阴影贴图：filterCode 0=硬边 1=3x3 2=5x5。
 * 返回 [0,1] 可见度（1 = 完全受光）。
 */
float unidrawShadowSample(sampler2D map, vec2 uv, float refDepth, float texel, float radius, int filterCode) {
  float r = max(radius, 0.0);
  if (filterCode <= 0 || r <= 0.0) return unidrawShadowTexel(map, uv, refDepth);
  int extent = filterCode >= 2 ? 2 : 1;
  float sum = 0.0;
  float taps = 0.0;
  for (int y = -2; y <= 2; y++) {
    if (y < -extent || y > extent) continue;
    for (int x = -2; x <= 2; x++) {
      if (x < -extent || x > extent) continue;
      vec2 o = vec2(float(x), float(y)) * texel * r;
      sum += unidrawShadowTexel(map, uv + o, refDepth);
      taps += 1.0;
    }
  }
  return sum / max(taps, 1.0);
}

float unidrawShadowMap(int m, vec2 uv, float refDepth, float texel, float radius, int filterCode) {
${dispatch}
  return 1.0;
}

/**
 * 阴影可见度：kind 0=方向光 1=聚光，lightIndex 是该类型内的序号。
 * 没有对应贴图时返回 1（完全受光）；返回前按强度混到 1（intensity 越小阴影越淡）。
 */
float unidrawShadow(int kind, int lightIndex, vec3 worldPos, vec3 normal, float ndl) {
  int count = int(u_shadowMeta.x);
  for (int m = 0; m < ${MAX_SHADOW_MAPS}; m++) {
    if (m >= count) break;
    if (int(u_shadowParams[m].z + 0.5) != kind) continue;
    if (int(u_shadowParams[m].w + 0.5) != lightIndex) continue;
    // 法线偏移（世界单位）：斜面/薄片的抗自阴影主力
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
    // 斜率相关偏移：掠射角（ndl 小）时用更大的偏移，抑制斜面上的自阴影条纹
    float slope = 1.0 + 2.0 * (1.0 - clamp(ndl, 0.0, 1.0));
    float bias = u_shadowParams[m].x * 0.5 * slope;   // 打包值按 WebGPU 归一化深度计算
    float visibility = unidrawShadowMap(
      m, uv, windowZ - bias, u_shadowParams[m].y, u_shadowParams2[m].x, int(u_shadowParams2[m].z + 0.5)
    );
    // 阴影强度：0 = 不投影，1 = 全黑
    return mix(1.0, visibility, clamp(u_shadowParams2[m].w, 0.0, 1.0));
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
    .map((i) => `  if (m == ${i}) { return unidrawShadowSample(u_shadowMap${i}, uv, refDepth, texel, radius, filterCode); }`)
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

fn unidrawShadowTexel(map : texture_depth_2d, uv : vec2f, refDepth : f32) -> f32 {
  // WebGPU 纹素原点在左上：v 轴翻转后再取整
  let size = vec2f(textureDimensions(map, 0));
  let t = vec2i(floor(vec2f(uv.x, 1.0 - uv.y) * size));
  return select(0.0, 1.0, refDepth <= textureLoad(map, t, 0));
}

/** filterCode 0=硬边 1=3x3 2=5x5 */
fn unidrawShadowSample(map : texture_depth_2d, uv : vec2f, refDepth : f32, texel : f32, radius : f32, filterCode : i32) -> f32 {
  let r = max(radius, 0.0);
  if (filterCode <= 0 || r <= 0.0) { return unidrawShadowTexel(map, uv, refDepth); }
  var extent = 1;
  if (filterCode >= 2) { extent = 2; }
  var sum = 0.0;
  var taps = 0.0;
  for (var y = -2; y <= 2; y = y + 1) {
    if (y < -extent || y > extent) { continue; }
    for (var x = -2; x <= 2; x = x + 1) {
      if (x < -extent || x > extent) { continue; }
      let o = vec2f(f32(x), f32(y)) * texel * r;
      sum = sum + unidrawShadowTexel(map, uv + o, refDepth);
      taps = taps + 1.0;
    }
  }
  return sum / max(taps, 1.0);
}

fn unidrawShadowMap(m : i32, uv : vec2f, refDepth : f32, texel : f32, radius : f32, filterCode : i32) -> f32 {
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
    let slope = 1.0 + 2.0 * (1.0 - clamp(ndl, 0.0, 1.0));
    let bias = shadows.u_shadowParams[m].x * slope;
    let visibility = unidrawShadowMap(
      m, uv, ndcZ - bias, shadows.u_shadowParams[m].y, shadows.u_shadowParams2[m].x, i32(shadows.u_shadowParams2[m].z + 0.5)
    );
    return mix(1.0, visibility, clamp(shadows.u_shadowParams2[m].w, 0.0, 1.0));
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
