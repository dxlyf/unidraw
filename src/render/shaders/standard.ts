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
