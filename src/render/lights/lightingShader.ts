/**
 * 光照代码片段（GLSL ES 3.00 与 WGSL 各一份），由内置材质拼接进 fragment shader。
 *
 * 统一入口：`unidrawLighting(n, worldPos, viewDir, ambientWeight) -> vec4(diffuse rgb, specular)`
 * - 环境光：`u_ambient × ambientWeight`（材质可用它调节“接收多少环境光”）；
 * - 方向光：`ndl = max(dot(n, -dir), 0)`，无衰减；
 * - 点光：`L = lightPos - worldPos`，`atten = 1/max(d,ε)^decay`；
 *   `range > 0` 时再乘平滑截断 `(clamp(1 - (d/range)^4, 0, 1))²`；
 * - 聚光：点光基础上乘 `smoothstep(cosInner, cosOuter, dot(-L, dir))`；
 * - 高光：Blinn-Phong，`h = normalize(L + viewDir)`，指数取 `u_params.x`（shininess）；
 *   调用方乘 `u_params.y`（强度）。
 *
 * UBO 布局见 `lights/LightsState.ts`；绑定固定为 `@group(0) @binding(3)`。
 */

import { MAX_DIRECTIONAL_LIGHTS, MAX_POINT_LIGHTS, MAX_SPOT_LIGHTS } from "./LightsState.js";

export interface LightingShaderOptions {
  /** 是否生成高光代码（PhongMaterial 需要） */
  specular?: boolean;
}

/** GLSL：LightsBlock 声明 + `unidrawLighting()` */
export function lightingGLSL(options: LightingShaderOptions = {}): string {
  const specular = options.specular ?? false;
  const specDir = specular
    ? `    if (ndl > 0.0) { vec3 h = normalize(L + viewDir); spec += pow(max(dot(n, h), 0.0), shininess); }`
    : "";
  return `
layout(std140) uniform LightsBlock {
  vec4 u_ambient;                       // rgb = 环境光颜色
  vec4 u_counts;                        // x=方向光数 y=点光数 z=聚光数
  vec4 u_dirDir[${MAX_DIRECTIONAL_LIGHTS}];    // xyz 方向
  vec4 u_dirColor[${MAX_DIRECTIONAL_LIGHTS}];  // rgb 颜色×强度
  vec4 u_pointPos[${MAX_POINT_LIGHTS}];        // xyz 位置, w 影响距离
  vec4 u_pointColor[${MAX_POINT_LIGHTS}];      // rgb 颜色×强度, a 衰减指数
  vec4 u_spotPos[${MAX_SPOT_LIGHTS}];          // xyz 位置, w 影响距离
  vec4 u_spotDir[${MAX_SPOT_LIGHTS}];          // xyz 方向, w cos(外锥角)
  vec4 u_spotColor[${MAX_SPOT_LIGHTS}];        // rgb 颜色×强度, a cos(内锥角)
};

vec4 unidrawLighting(vec3 n, vec3 worldPos, vec3 viewDir, float ambientWeight) {
  vec3 diffuse = u_ambient.rgb * ambientWeight;
  float spec = 0.0;
  float shininess = max(u_params.x, 1.0);
  int dirCount = int(u_counts.x);
  int pointCount = int(u_counts.y);
  int spotCount = int(u_counts.z);

  for (int i = 0; i < ${MAX_DIRECTIONAL_LIGHTS}; i++) {
    if (i >= dirCount) break;
    vec3 L = -u_dirDir[i].xyz;
    float ndl = max(dot(n, L), 0.0);
    diffuse += u_dirColor[i].rgb * ndl;
${specDir}
  }

  for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {
    if (i >= pointCount) break;
    vec3 toLight = u_pointPos[i].xyz - worldPos;
    float d = length(toLight);
    if (d < 1e-5) continue;
    vec3 L = toLight / d;
    float atten = 1.0 / pow(max(d, 1e-4), u_pointColor[i].a);
    float range = u_pointPos[i].w;
    if (range > 0.0) { float f = clamp(1.0 - pow(d / range, 4.0), 0.0, 1.0); atten *= f * f; }
    float ndl = max(dot(n, L), 0.0);
    diffuse += u_pointColor[i].rgb * ndl * atten;
${specular ? `    if (ndl > 0.0) { vec3 h = normalize(L + viewDir); spec += atten * pow(max(dot(n, h), 0.0), shininess); }` : ""}
  }

  for (int i = 0; i < ${MAX_SPOT_LIGHTS}; i++) {
    if (i >= spotCount) break;
    vec3 toLight = u_spotPos[i].xyz - worldPos;
    float d = length(toLight);
    if (d < 1e-5) continue;
    vec3 L = toLight / d;
    float cone = smoothstep(u_spotColor[i].a, u_spotDir[i].w, dot(-L, u_spotDir[i].xyz));
    if (cone <= 0.0) continue;
    float atten = cone / pow(max(d, 1e-4), 2.0);
    float range = u_spotPos[i].w;
    if (range > 0.0) { float f = clamp(1.0 - pow(d / range, 4.0), 0.0, 1.0); atten *= f * f; }
    float ndl = max(dot(n, L), 0.0);
    diffuse += u_spotColor[i].rgb * ndl * atten;
${specular ? `    if (ndl > 0.0) { vec3 h = normalize(L + viewDir); spec += atten * pow(max(dot(n, h), 0.0), shininess); }` : ""}
  }

  return vec4(diffuse, spec);
}
`;
}

/** WGSL：与 GLSL 版本逐项对应的 `unidrawLighting()` */
export function lightingWGSL(options: LightingShaderOptions = {}): string {
  const specular = options.specular ?? false;
  return `
struct LightsBlock {
  u_ambient : vec4f,
  u_counts : vec4f,
  u_dirDir : array<vec4f, ${MAX_DIRECTIONAL_LIGHTS}>,
  u_dirColor : array<vec4f, ${MAX_DIRECTIONAL_LIGHTS}>,
  u_pointPos : array<vec4f, ${MAX_POINT_LIGHTS}>,
  u_pointColor : array<vec4f, ${MAX_POINT_LIGHTS}>,
  u_spotPos : array<vec4f, ${MAX_SPOT_LIGHTS}>,
  u_spotDir : array<vec4f, ${MAX_SPOT_LIGHTS}>,
  u_spotColor : array<vec4f, ${MAX_SPOT_LIGHTS}>,
};
@group(0) @binding(3) var<uniform> lights : LightsBlock;

fn unidrawLighting(n : vec3f, worldPos : vec3f, viewDir : vec3f, ambientWeight : f32) -> vec4f {
  var diffuse = lights.u_ambient.rgb * ambientWeight;
  var spec = 0.0;
  let shininess = max(material.u_params.x, 1.0);
  let dirCount = i32(lights.u_counts.x);
  let pointCount = i32(lights.u_counts.y);
  let spotCount = i32(lights.u_counts.z);

  for (var i = 0; i < ${MAX_DIRECTIONAL_LIGHTS}; i = i + 1) {
    if (i >= dirCount) { break; }
    let L = -lights.u_dirDir[i].xyz;
    let ndl = max(dot(n, L), 0.0);
    diffuse = diffuse + lights.u_dirColor[i].rgb * ndl;
${specular ? `    if (ndl > 0.0) { let h = normalize(L + viewDir); spec = spec + pow(max(dot(n, h), 0.0), shininess); }` : ""}
  }

  for (var i = 0; i < ${MAX_POINT_LIGHTS}; i = i + 1) {
    if (i >= pointCount) { break; }
    let toLight = lights.u_pointPos[i].xyz - worldPos;
    let d = length(toLight);
    if (d < 1e-5) { continue; }
    let L = toLight / d;
    var atten = 1.0 / pow(max(d, 1e-4), lights.u_pointColor[i].a);
    let range = lights.u_pointPos[i].w;
    if (range > 0.0) { let f = clamp(1.0 - pow(d / range, 4.0), 0.0, 1.0); atten = atten * f * f; }
    let ndl = max(dot(n, L), 0.0);
    diffuse = diffuse + lights.u_pointColor[i].rgb * ndl * atten;
${specular ? `    if (ndl > 0.0) { let h = normalize(L + viewDir); spec = spec + atten * pow(max(dot(n, h), 0.0), shininess); }` : ""}
  }

  for (var i = 0; i < ${MAX_SPOT_LIGHTS}; i = i + 1) {
    if (i >= spotCount) { break; }
    let toLight = lights.u_spotPos[i].xyz - worldPos;
    let d = length(toLight);
    if (d < 1e-5) { continue; }
    let L = toLight / d;
    let cone = smoothstep(lights.u_spotColor[i].a, lights.u_spotDir[i].w, dot(-L, lights.u_spotDir[i].xyz));
    if (cone <= 0.0) { continue; }
    var atten = cone / pow(max(d, 1e-4), 2.0);
    let range = lights.u_spotPos[i].w;
    if (range > 0.0) { let f = clamp(1.0 - pow(d / range, 4.0), 0.0, 1.0); atten = atten * f * f; }
    let ndl = max(dot(n, L), 0.0);
    diffuse = diffuse + lights.u_spotColor[i].rgb * ndl * atten;
${specular ? `    if (ndl > 0.0) { let h = normalize(L + viewDir); spec = spec + atten * pow(max(dot(n, h), 0.0), shininess); }` : ""}
  }

  return vec4f(diffuse, spec);
}
`;
}
