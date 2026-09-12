// 顶点着色器之外，本文件还导出 metallic-roughness PBR 的片元着色器
// （`FRAGMENT_GLSL` / `FRAGMENT_WGSL`，见文件末尾）：它们需要复用标准灯光块与阴影查询。
import { MAX_DIRECTIONAL_LIGHTS, MAX_POINT_LIGHTS, MAX_SPOT_LIGHTS } from "../lights/LightsState.js";
import { lightingGLSL, lightingWGSL } from "../lights/lightingShader.js";

export const VERTEX_GLSL = `#version 300 es
precision highp float;

layout(std140) uniform CameraBlock {
  mat4 u_viewProj;
  vec4 u_cameraPos;
};
layout(std140) uniform ModelBlock {
  mat4 u_model;
};

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;

out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_uv;

void main() {
  vec4 world = u_model * vec4(a_position, 1.0);
  v_worldPos = world.xyz;
  v_normal = normalize(mat3(u_model) * a_normal);
  v_uv = a_uv;
  gl_Position = u_viewProj * world;
}
`;

export const VERTEX_WGSL = `
struct CameraBlock {
  u_viewProj : mat4x4f,
  u_cameraPos : vec4f,
};
struct ModelBlock {
  u_model : mat4x4f,
};
@group(0) @binding(0) var<uniform> camera : CameraBlock;
@group(0) @binding(1) var<uniform> model : ModelBlock;

struct VSIn {
  @location(0) a_position : vec3f,
  @location(1) a_normal : vec3f,
  @location(2) a_uv : vec2f,
};
struct VSOut {
  @builtin(position) clip_pos : vec4f,
  @location(0) v_worldPos : vec3f,
  @location(1) v_normal : vec3f,
  @location(2) v_uv : vec2f,
};

@vertex
fn vs_main(in : VSIn) -> VSOut {
  var out : VSOut;
  let world = model.u_model * vec4f(in.a_position, 1.0);
  out.v_worldPos = world.xyz;
  // 法线用 w=0 的向量乘 mat4，避免依赖“矩阵截断构造”这类各实现不一致的写法
  out.v_normal = normalize((model.u_model * vec4f(in.a_normal, 0.0)).xyz);
  out.v_uv = in.a_uv;
  out.clip_pos = camera.u_viewProj * world;
  return out;
}
`;

/**
 * 实例化版本的顶点着色器：多了 location 3..6（列主序的实例矩阵）。
 *
 * 顶点位置最终为 `u_model * instanceMatrix * position` —— 也就是说 `u_model`
 * 仍然是「整个 InstancedMesh 的基准变换」，实例矩阵叠加在它之上。
 * `InstancedMesh` 的实例缓冲就是按 `float32x4 × 4（stride 64）+ stepMode: instance` 布局的。
 */
export const VERTEX_INSTANCED_GLSL = `#version 300 es
precision highp float;

layout(std140) uniform CameraBlock {
  mat4 u_viewProj;
  vec4 u_cameraPos;
};
layout(std140) uniform ModelBlock {
  mat4 u_model;
};

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
// 实例矩阵（列主序，每列一个 vec4）
layout(location = 3) in vec4 a_instance0;
layout(location = 4) in vec4 a_instance1;
layout(location = 5) in vec4 a_instance2;
layout(location = 6) in vec4 a_instance3;

out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_uv;

void main() {
  mat4 instance = mat4(a_instance0, a_instance1, a_instance2, a_instance3);
  mat4 model = u_model * instance;
  vec4 world = model * vec4(a_position, 1.0);
  v_worldPos = world.xyz;
  v_normal = normalize(mat3(model) * a_normal);
  v_uv = a_uv;
  gl_Position = u_viewProj * world;
}
`;

/** WGSL 版实例化顶点着色器（与 `VERTEX_INSTANCED_GLSL` 逐项对应） */
export const VERTEX_INSTANCED_WGSL = `
struct CameraBlock {
  u_viewProj : mat4x4f,
  u_cameraPos : vec4f,
};
struct ModelBlock {
  u_model : mat4x4f,
};
@group(0) @binding(0) var<uniform> camera : CameraBlock;
@group(0) @binding(1) var<uniform> model : ModelBlock;

struct VSIn {
  @location(0) a_position : vec3f,
  @location(1) a_normal : vec3f,
  @location(2) a_uv : vec2f,
  @location(3) a_instance0 : vec4f,
  @location(4) a_instance1 : vec4f,
  @location(5) a_instance2 : vec4f,
  @location(6) a_instance3 : vec4f,
};
struct VSOut {
  @builtin(position) clip_pos : vec4f,
  @location(0) v_worldPos : vec3f,
  @location(1) v_normal : vec3f,
  @location(2) v_uv : vec2f,
};

@vertex
fn vs_main(in : VSIn) -> VSOut {
  var out : VSOut;
  let instance = mat4x4f(in.a_instance0, in.a_instance1, in.a_instance2, in.a_instance3);
  let world = model.u_model * instance * vec4f(in.a_position, 1.0);
  out.v_worldPos = world.xyz;
  out.v_normal = normalize((model.u_model * instance * vec4f(in.a_normal, 0.0)).xyz);
  out.v_uv = in.a_uv;
  out.clip_pos = camera.u_viewProj * world;
  return out;
}
`;

// ---------------------------------------------------------------------------
// metallic-roughness PBR 片元着色器（对齐 three.js 的 `MeshStandardMaterial`）
//
// 直接光：Cook-Torrance —— D = GGX/Trowbridge-Reitz，G = Smith（height-correlated
// 的 Schlick-GGX 形式，已含 1/(4·NdotL·NdotV)），F = Schlick 菲涅尔；环境光用
// 「无 IBL 的常量辐照度」近似（见 main 末尾注释）。
//
// 灯光数据**完全复用** `lightingShader.ts`：`LightsBlock` 的声明、方向光/点光/聚光的
// 距离衰减与锥角公式、阴影可见度查询都由 `lightingGLSL()/lightingWGSL()` 提供
// （std140 布局只有一份）。这里只把「逐灯累加」换成 PBR BRDF，因此没有调用
// `unidrawLighting()`：它把 diffuse 与 Blinn-Phong 高光耦合在同一个返回值里。
//
// UBO 约定（`StandardMaterial` 写入）：
//   MaterialBlock: u_color    = albedo.rgb + alpha
//                  u_params   = (roughness, metalness, normalScale, 保留)
//   StandardBlock: u_emissive = 自发光 rgb + 强度(w)
//                  u_flags    = (有 map, 有 normalMap, 保留, 保留)
// 纹理 binding：4 = u_albedo(map)，5 = u_normalMap；15/16 = 与它们按顺序配对的采样器
// （WebGL2 的纹理/采样器是按顺序配对的）。
//
// 与 Phong 一致：**不做 tone mapping / gamma**，输出线性值交后处理统一处理。
// ---------------------------------------------------------------------------

/** GLSL ES 3.00 版 PBR 片元着色器（与 `FRAGMENT_WGSL` 逐项对应）。 */
export const FRAGMENT_GLSL = `#version 300 es
precision highp float;

layout(std140) uniform CameraBlock {
  mat4 u_viewProj;
  vec4 u_cameraPos;
};
layout(std140) uniform MaterialBlock {
  vec4 u_color;     // rgb = 基础色(albedo)，a = 不透明度
  vec4 u_params;    // x = roughness, y = metalness, z = normalScale, w = 保留
};
layout(std140) uniform StandardBlock {
  vec4 u_emissive;  // rgb = 自发光颜色, w = 自发光强度
  vec4 u_flags;     // x = 有基础色贴图, y = 有法线贴图
};
${lightingGLSL({ specular: false })}
uniform sampler2D u_albedo;
uniform sampler2D u_normalMap;

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;
out vec4 fragColor;

const float UNIDRAW_PI = 3.141592653589793;
/** three.js 的 roughness 下限（避免 roughness = 0 时 GGX 数值爆炸） */
const float UNIDRAW_MIN_ROUGHNESS = 0.0525;

/** GGX/Trowbridge-Reitz 法线分布；alpha = roughness²（与 three.js 的 D_GGX 同约定） */
float unidrawDistributionGGX(float ndh, float alpha) {
  float a2 = alpha * alpha;
  float d = ndh * ndh * (a2 - 1.0) + 1.0;
  return a2 / max(UNIDRAW_PI * d * d, 1e-7);
}

/** Smith 几何项（height-correlated / Schlick-GGX；已含 1/(4·NdotL·NdotV)） */
float unidrawSmithGGXCorrelated(float ndv, float ndl, float alpha) {
  float a2 = alpha * alpha;
  float gv = ndl * sqrt(a2 + (1.0 - a2) * ndv * ndv);
  float gl = ndv * sqrt(a2 + (1.0 - a2) * ndl * ndl);
  return 0.5 / max(gv + gl, 1e-5);
}

/** Schlick 菲涅尔 */
vec3 unidrawFresnelSchlick(float vdh, vec3 f0) {
  return f0 + (vec3(1.0) - f0) * pow(clamp(1.0 - vdh, 0.0, 1.0), 5.0);
}

/**
 * cotangent frame：只用屏幕空间导数从世界坐标与 uv 反解切线空间基（Schüller 的写法）。
 *
 * 顶点格式里没有切线属性，这是法线贴图的最小代价方案；近似成立的前提是
 * 「一个像素 quad 内 uv 线性变化」，因此三角面内 uv 退化（导数为 0）或强透视时会有误差。
 */
mat3 unidrawCotangentFrame(vec3 n, vec3 p, vec2 uv) {
  vec3 dp1 = dFdx(p);
  vec3 dp2 = dFdy(p);
  vec2 duv1 = dFdx(uv);
  vec2 duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, n);
  vec3 dp1perp = cross(n, dp1);
  vec3 t = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 b = dp2perp * duv1.y + dp1perp * duv2.y;
  // uv 退化时 dot 可能为 0：用 max 兜底，避免 inversesqrt(0) = inf 产生 NaN
  float invmax = inversesqrt(max(max(dot(t, t), dot(b, b)), 1e-12));
  return mat3(t * invmax, b * invmax, n);
}

/**
 * 单个直接光的 PBR 贡献（已含 radiance 与 NdotL）。
 *
 * 漫反射 = albedo * (1 - metalness) * kD，kD = (1 - F) * (1 - metalness)；
 * 镜面 = D * V * F（V 已含 1/(4·NdotL·NdotV)）。
 * 注：框架里灯光的颜色是「颜色 × 强度」而不是辐射度单位，为与 Phong/Texture 材质的
 * 亮度约定一致，漫反射项不做 1/π 归一（镜面的 1/π 在 D 里，是 GGX 的一部分）。
 */
vec3 unidrawDirectBrdf(vec3 n, vec3 v, vec3 l, float ndl, vec3 radiance, vec3 albedo, float metalness, vec3 f0, float alpha, float ndv) {
  // 半程向量：l + v 在「光正好位于视线反方向」时为 0，用 max 长度避免 NaN
  vec3 h = (l + v) / max(length(l + v), 1e-6);
  float ndh = max(dot(n, h), 0.0);
  float vdh = max(dot(v, h), 0.0);
  vec3 f = unidrawFresnelSchlick(vdh, f0);
  float d = unidrawDistributionGGX(ndh, alpha);
  float vis = unidrawSmithGGXCorrelated(ndv, ndl, alpha);
  vec3 kd = (vec3(1.0) - f) * (1.0 - metalness);
  vec3 diffuse = albedo * (1.0 - metalness) * kd;
  vec3 specular = d * vis * f;
  return (diffuse + specular) * radiance * ndl;
}

void main() {
  // 贴图**无条件采样**：WGSL 禁止在非一致控制流里 textureSample，所以这里先取两张贴图的
  // 采样值，再用 UBO 里的 flags 做 mix；未设置贴图时绑定的是 1×1 占位纹理。
  vec3 albedoTex = texture(u_albedo, v_uv).rgb;
  vec3 normalTex = texture(u_normalMap, v_uv).xyz * 2.0 - 1.0;
  vec3 albedo = u_color.rgb * mix(vec3(1.0), albedoTex, u_flags.x);

  vec3 n = normalize(v_normal);
  vec3 v = normalize(u_cameraPos.xyz - v_worldPos);
  float ndv = max(dot(n, v), 1e-4);

  // 法线贴图：材质级开关（UBO 里的 flags）属于**一致控制流**，两个后端都可以安全分支。
  // 约定为 OpenGL 风格的切线空间（绿通道 = +Y，与 three.js 的默认法线贴图一致）。
  if (u_flags.y > 0.5) {
    mat3 tbn = unidrawCotangentFrame(n, v_worldPos, v_uv);
    n = normalize(tbn * vec3(normalTex.xy * u_params.z, normalTex.z));
  }

  float rough = clamp(u_params.x, 0.0, 1.0);
  float metalness = clamp(u_params.y, 0.0, 1.0);
  float alpha = max(rough, UNIDRAW_MIN_ROUGHNESS);
  alpha = alpha * alpha;

  // metalness 工作流：电介质 F0 = 0.04，金属 F0 = albedo
  vec3 f0 = mix(vec3(0.04), albedo, metalness);

  vec3 direct = vec3(0.0);
  int dirCount = int(u_counts.x);
  int pointCount = int(u_counts.y);
  int spotCount = int(u_counts.z);

  // 方向光：无衰减；阴影可见度只乘这条直接光（环境光不受阴影影响）
  for (int i = 0; i < ${MAX_DIRECTIONAL_LIGHTS}; i++) {
    if (i >= dirCount) break;
    vec3 l = -u_dirDir[i].xyz;
    float ndl = max(dot(n, l), 0.0);
    float shadow = unidrawShadow(0, i, v_worldPos, n, ndl);
    direct += unidrawDirectBrdf(n, v, l, ndl, u_dirColor[i].rgb, albedo, metalness, f0, alpha, ndv) * shadow;
  }

  // 点光：衰减与 lightingShader.ts 完全一致（1/d^decay + range 的平滑截断），不投影
  for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {
    if (i >= pointCount) break;
    vec3 toLight = u_pointPos[i].xyz - v_worldPos;
    float d = length(toLight);
    if (d < 1e-5) continue;
    vec3 l = toLight / d;
    float atten = 1.0 / pow(max(d, 1e-4), u_pointColor[i].a);
    float range = u_pointPos[i].w;
    if (range > 0.0) { float win = clamp(1.0 - pow(d / range, 4.0), 0.0, 1.0); atten *= win * win; }
    float ndl = max(dot(n, l), 0.0);
    direct += unidrawDirectBrdf(n, v, l, ndl, u_pointColor[i].rgb * atten, albedo, metalness, f0, alpha, ndv);
  }

  // 聚光：cone = smoothstep(cosInner, cosOuter, ...)，固定 1/d²（与 lightingShader.ts 一致）
  for (int i = 0; i < ${MAX_SPOT_LIGHTS}; i++) {
    if (i >= spotCount) break;
    vec3 toLight = u_spotPos[i].xyz - v_worldPos;
    float d = length(toLight);
    if (d < 1e-5) continue;
    vec3 l = toLight / d;
    float cone = smoothstep(u_spotColor[i].a, u_spotDir[i].w, dot(-l, u_spotDir[i].xyz));
    if (cone <= 0.0) continue;
    float atten = cone / pow(max(d, 1e-4), 2.0);
    float range = u_spotPos[i].w;
    if (range > 0.0) { float win = clamp(1.0 - pow(d / range, 4.0), 0.0, 1.0); atten *= win * win; }
    float ndl = max(dot(n, l), 0.0);
    float shadow = unidrawShadow(1, i, v_worldPos, n, ndl);
    direct += unidrawDirectBrdf(n, v, l, ndl, u_spotColor[i].rgb * atten, albedo, metalness, f0, alpha, ndv) * shadow;
  }

  // 环境光：**无 IBL 时的常量辐照度近似**（没有环境贴图，故无 roughness 相关的预滤波）：
  //  - 漫反射：ambient * albedo * (1 - metalness)
  //  - 镜面：  ambient * F0 —— 金属的 F0 = albedo，所以纯金属在只有环境光时也不会全黑；
  // 掠射角不做 Fresnel 提升（那需要 envBRDF/环境贴图，常量辐照度下提升会失真）。
  vec3 ambient = u_ambient.rgb;
  vec3 ambientDiffuse = ambient * albedo * (1.0 - metalness);
  vec3 ambientSpecular = ambient * f0;

  // 自发光：不受灯光/阴影影响（强度由 u_emissive.w 携带）
  vec3 emissive = u_emissive.rgb * u_emissive.w;

  fragColor = vec4(direct + ambientDiffuse + ambientSpecular + emissive, u_color.a);
}
`;

/** WGSL 版 PBR 片元着色器（与 `FRAGMENT_GLSL` 逐项对应）。 */
export const FRAGMENT_WGSL = `
struct MaterialBlock {
  u_color : vec4f,
  u_params : vec4f,
};
@group(0) @binding(2) var<uniform> material : MaterialBlock;
struct StandardBlock {
  u_emissive : vec4f,
  u_flags : vec4f,
};
@group(0) @binding(17) var<uniform> standard : StandardBlock;
${lightingWGSL({ specular: false })}
@group(0) @binding(4) var u_albedo : texture_2d<f32>;
@group(0) @binding(5) var u_normalMap : texture_2d<f32>;
@group(0) @binding(15) var u_albedoSampler : sampler;
@group(0) @binding(16) var u_normalSampler : sampler;

const UNIDRAW_PI : f32 = 3.141592653589793;
const UNIDRAW_MIN_ROUGHNESS : f32 = 0.0525;

/** GGX/Trowbridge-Reitz 法线分布；alpha = roughness²（与 GLSL 版逐项对应） */
fn unidrawDistributionGGX(ndh : f32, alpha : f32) -> f32 {
  let a2 = alpha * alpha;
  let d = ndh * ndh * (a2 - 1.0) + 1.0;
  return a2 / max(UNIDRAW_PI * d * d, 1e-7);
}

/** Smith 几何项（height-correlated / Schlick-GGX；已含 1/(4·NdotL·NdotV)） */
fn unidrawSmithGGXCorrelated(ndv : f32, ndl : f32, alpha : f32) -> f32 {
  let a2 = alpha * alpha;
  let gv = ndl * sqrt(a2 + (1.0 - a2) * ndv * ndv);
  let gl = ndv * sqrt(a2 + (1.0 - a2) * ndl * ndl);
  return 0.5 / max(gv + gl, 1e-5);
}

/** Schlick 菲涅尔 */
fn unidrawFresnelSchlick(vdh : f32, f0 : vec3f) -> vec3f {
  return f0 + (vec3f(1.0) - f0) * pow(clamp(1.0 - vdh, 0.0, 1.0), 5.0);
}

/** cotangent frame（与 GLSL 版逐项对应；uv 退化时用 max 兜底避免 NaN） */
fn unidrawCotangentFrame(n : vec3f, p : vec3f, uv : vec2f) -> mat3x3f {
  let dp1 = dpdx(p);
  let dp2 = dpdy(p);
  let duv1 = dpdx(uv);
  let duv2 = dpdy(uv);
  let dp2perp = cross(dp2, n);
  let dp1perp = cross(n, dp1);
  let t = dp2perp * duv1.x + dp1perp * duv2.x;
  let b = dp2perp * duv1.y + dp1perp * duv2.y;
  let invmax = inverseSqrt(max(max(dot(t, t), dot(b, b)), 1e-12));
  return mat3x3f(t * invmax, b * invmax, n);
}

/** 单个直接光的 PBR 贡献（与 GLSL 版逐项对应） */
fn unidrawDirectBrdf(n : vec3f, v : vec3f, l : vec3f, ndl : f32, radiance : vec3f, albedo : vec3f, metalness : f32, f0 : vec3f, alpha : f32, ndv : f32) -> vec3f {
  let h = (l + v) / max(length(l + v), 1e-6);
  let ndh = max(dot(n, h), 0.0);
  let vdh = max(dot(v, h), 0.0);
  let f = unidrawFresnelSchlick(vdh, f0);
  let d = unidrawDistributionGGX(ndh, alpha);
  let vis = unidrawSmithGGXCorrelated(ndv, ndl, alpha);
  let kd = (vec3f(1.0) - f) * (1.0 - metalness);
  let diffuse = albedo * (1.0 - metalness) * kd;
  let specular = d * vis * f;
  return (diffuse + specular) * radiance * ndl;
}

struct FSIn {
  @builtin(position) clip_pos : vec4f,
  @location(0) v_worldPos : vec3f,
  @location(1) v_normal : vec3f,
  @location(2) v_uv : vec2f,
};

@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  // 无条件采样（textureSample 必须处于一致控制流）；材质级开关用 flags 做 mix
  let albedoTex = textureSample(u_albedo, u_albedoSampler, in.v_uv).rgb;
  let normalTex = textureSample(u_normalMap, u_normalSampler, in.v_uv).xyz * 2.0 - 1.0;
  let albedo = material.u_color.rgb * mix(vec3f(1.0), albedoTex, standard.u_flags.x);

  var n = normalize(in.v_normal);
  let v = normalize(camera.u_cameraPos.xyz - in.v_worldPos);
  let ndv = max(dot(n, v), 1e-4);

  // flags 来自 UBO → 一致控制流，分支里的 dpdx/dpdy 合法
  if (standard.u_flags.y > 0.5) {
    let tbn = unidrawCotangentFrame(n, in.v_worldPos, in.v_uv);
    n = normalize(tbn * vec3f(normalTex.xy * material.u_params.z, normalTex.z));
  }

  let rough = clamp(material.u_params.x, 0.0, 1.0);
  let metalness = clamp(material.u_params.y, 0.0, 1.0);
  let roughness = max(rough, UNIDRAW_MIN_ROUGHNESS);
  let alpha = roughness * roughness;
  let f0 = mix(vec3f(0.04), albedo, metalness);

  var direct = vec3f(0.0);
  let dirCount = i32(lights.u_counts.x);
  let pointCount = i32(lights.u_counts.y);
  let spotCount = i32(lights.u_counts.z);

  // 方向光：无衰减；阴影可见度只乘这条直接光（环境光不受阴影影响）
  for (var i = 0; i < ${MAX_DIRECTIONAL_LIGHTS}; i = i + 1) {
    if (i >= dirCount) { break; }
    let l = -lights.u_dirDir[i].xyz;
    let ndl = max(dot(n, l), 0.0);
    let shadow = unidrawShadow(0, i, in.v_worldPos, n, ndl);
    direct = direct + unidrawDirectBrdf(n, v, l, ndl, lights.u_dirColor[i].rgb, albedo, metalness, f0, alpha, ndv) * shadow;
  }

  // 点光：衰减与 lightingShader.ts 完全一致（1/d^decay + range 的平滑截断），不投影
  for (var i = 0; i < ${MAX_POINT_LIGHTS}; i = i + 1) {
    if (i >= pointCount) { break; }
    let toLight = lights.u_pointPos[i].xyz - in.v_worldPos;
    let d = length(toLight);
    if (d < 1e-5) { continue; }
    let l = toLight / d;
    var atten = 1.0 / pow(max(d, 1e-4), lights.u_pointColor[i].a);
    let range = lights.u_pointPos[i].w;
    if (range > 0.0) { let win = clamp(1.0 - pow(d / range, 4.0), 0.0, 1.0); atten = atten * win * win; }
    let ndl = max(dot(n, l), 0.0);
    direct = direct + unidrawDirectBrdf(n, v, l, ndl, lights.u_pointColor[i].rgb * atten, albedo, metalness, f0, alpha, ndv);
  }

  // 聚光：cone = smoothstep(cosInner, cosOuter, ...)，固定 1/d²（与 lightingShader.ts 一致）
  for (var i = 0; i < ${MAX_SPOT_LIGHTS}; i = i + 1) {
    if (i >= spotCount) { break; }
    let toLight = lights.u_spotPos[i].xyz - in.v_worldPos;
    let d = length(toLight);
    if (d < 1e-5) { continue; }
    let l = toLight / d;
    let cone = smoothstep(lights.u_spotColor[i].a, lights.u_spotDir[i].w, dot(-l, lights.u_spotDir[i].xyz));
    if (cone <= 0.0) { continue; }
    var atten = cone / pow(max(d, 1e-4), 2.0);
    let range = lights.u_spotPos[i].w;
    if (range > 0.0) { let win = clamp(1.0 - pow(d / range, 4.0), 0.0, 1.0); atten = atten * win * win; }
    let ndl = max(dot(n, l), 0.0);
    let shadow = unidrawShadow(1, i, in.v_worldPos, n, ndl);
    direct = direct + unidrawDirectBrdf(n, v, l, ndl, lights.u_spotColor[i].rgb * atten, albedo, metalness, f0, alpha, ndv) * shadow;
  }

  // 环境光：无 IBL 的常量辐照度近似（漫反射 ambient*albedo*(1-metalness) + 镜面 ambient*F0）
  let ambient = lights.u_ambient.rgb;
  let ambientDiffuse = ambient * albedo * (1.0 - metalness);
  let ambientSpecular = ambient * f0;
  let emissive = standard.u_emissive.rgb * standard.u_emissive.w;

  // 不做 tone mapping / gamma（与 Phong 的输出约定一致，交后处理统一处理）
  return vec4f(direct + ambientDiffuse + ambientSpecular + emissive, material.u_color.a);
}
`;
