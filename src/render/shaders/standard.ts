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
