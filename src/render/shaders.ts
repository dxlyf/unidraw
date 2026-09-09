/**
 * 内置材质着色器（GLSL ES 3.00 + WGSL 双实现）。
 *
 * bind group 0 布局约定（三种内置材质一致）：
 *   binding 0  CameraBlock   { mat4 u_viewProj; vec4 u_cameraPos; }  → 80B
 *   binding 1  ModelBlock    { mat4 u_model; }                        → 64B
 *   binding 2  MaterialBlock { vec4 u_color; }                        → 16B
 *   binding 3  texture u_albedo（纹理材质）
 *   binding 4  sampler u_albedoSampler
 *
 * 顶点布局（标准布局，stride 32B）：
 *   location 0: a_position vec3 (offset 0)
 *   location 1: a_normal   vec3 (offset 12)
 *   location 2: a_uv       vec2 (offset 24)
 *
 * GLSL 中 uniform block 名必须等于 bind group layout entry 的 name
 * （后端据此做 UBO binding point 映射）。
 */

// ---------------------------------------------------------------------------
// 顶点（两材质共用）
// ---------------------------------------------------------------------------

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
  out.v_normal = normalize(mat3x3f(model.u_model) * in.a_normal);
  out.v_uv = in.a_uv;
  out.clip_pos = camera.u_viewProj * world;
  return out;
}
`;

// ---------------------------------------------------------------------------
// 颜色材质片元
// ---------------------------------------------------------------------------

export const COLOR_FRAGMENT_GLSL = `#version 300 es
precision highp float;

layout(std140) uniform MaterialBlock {
  vec4 u_color;
};

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  vec3 n = normalize(v_normal);
  vec3 lightDir = normalize(vec3(0.35, 0.75, 0.55));
  float ndl = max(dot(n, lightDir), 0.0);
  vec3 color = u_color.rgb * (0.35 + 0.65 * ndl);
  fragColor = vec4(color, u_color.a);
}
`;

export const COLOR_FRAGMENT_WGSL = `
struct MaterialBlock {
  u_color : vec4f,
};
@group(0) @binding(2) var<uniform> material : MaterialBlock;

struct FSIn {
  @builtin(position) clip_pos : vec4f,
  @location(0) v_worldPos : vec3f,
  @location(1) v_normal : vec3f,
  @location(2) v_uv : vec2f,
};

@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  let n = normalize(in.v_normal);
  let lightDir = normalize(vec3f(0.35, 0.75, 0.55));
  let ndl = max(dot(n, lightDir), 0.0);
  let color = material.u_color.rgb * (0.35 + 0.65 * ndl);
  return vec4f(color, material.u_color.a);
}
`;

// ---------------------------------------------------------------------------
// 纹理材质片元
// ---------------------------------------------------------------------------

export const TEXTURE_FRAGMENT_GLSL = `#version 300 es
precision highp float;

layout(std140) uniform MaterialBlock {
  vec4 u_color;
};
uniform sampler2D u_albedo;

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  vec4 albedo = texture(u_albedo, v_uv) * u_color;
  vec3 n = normalize(v_normal);
  vec3 lightDir = normalize(vec3(0.35, 0.75, 0.55));
  float ndl = max(dot(n, lightDir), 0.0);
  vec3 color = albedo.rgb * (0.35 + 0.65 * ndl);
  fragColor = vec4(color, albedo.a);
}
`;

export const TEXTURE_FRAGMENT_WGSL = `
struct MaterialBlock {
  u_color : vec4f,
};
@group(0) @binding(2) var<uniform> material : MaterialBlock;
@group(0) @binding(3) var u_albedo : texture_2d<f32>;
@group(0) @binding(4) var u_albedoSampler : sampler;

struct FSIn {
  @builtin(position) clip_pos : vec4f,
  @location(0) v_worldPos : vec3f,
  @location(1) v_normal : vec3f,
  @location(2) v_uv : vec2f,
};

@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  let albedo = textureSample(u_albedo, u_albedoSampler, in.v_uv) * material.u_color;
  let n = normalize(in.v_normal);
  let lightDir = normalize(vec3f(0.35, 0.75, 0.55));
  let ndl = max(dot(n, lightDir), 0.0);
  let color = albedo.rgb * (0.35 + 0.65 * ndl);
  return vec4f(color, albedo.a);
}
`;

// ---------------------------------------------------------------------------
// 全屏 blit（离屏纹理 → 屏幕，含可选色调）
// ---------------------------------------------------------------------------

export const BLIT_VERTEX_GLSL = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
layout(location = 2) in vec2 a_uv;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_position, 1.0);
}
`;

export const BLIT_VERTEX_WGSL = `
struct VSIn {
  @location(0) a_position : vec3f,
  @location(2) a_uv : vec2f,
};
struct VSOut {
  @builtin(position) clip_pos : vec4f,
  @location(0) v_uv : vec2f,
};
@vertex
fn vs_main(in : VSIn) -> VSOut {
  var out : VSOut;
  out.v_uv = in.a_uv;
  out.clip_pos = vec4f(in.a_position, 1.0);
  return out;
}
`;

export const BLIT_FRAGMENT_GLSL = `#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform vec4 u_tint;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_source, v_uv);
  fragColor = vec4(c.rgb * u_tint.rgb, c.a * u_tint.a);
}
`;

export const BLIT_FRAGMENT_WGSL = `
struct BlitBlock {
  u_tint : vec4f,
};
@group(0) @binding(0) var u_source : texture_2d<f32>;
@group(0) @binding(1) var u_sourceSampler : sampler;
@group(0) @binding(2) var<uniform> blit : BlitBlock;

struct FSIn {
  @builtin(position) clip_pos : vec4f,
  @location(0) v_uv : vec2f,
};
@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  let c = textureSample(u_source, u_sourceSampler, in.v_uv);
  return vec4f(c.rgb * blit.u_tint.rgb, c.a * blit.u_tint.a);
}
`;
