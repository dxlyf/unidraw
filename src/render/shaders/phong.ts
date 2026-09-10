
// ---------------------------------------------------------------------------
// Blinn-Phong（u_params.x=shininess, y=spec 强度, z=ambient, w=保留）
// ---------------------------------------------------------------------------
export const PHONG_FRAGMENT_GLSL = `#version 300 es
precision highp float;

layout(std140) uniform CameraBlock {
  mat4 u_viewProj;
  vec4 u_cameraPos;
};
layout(std140) uniform MaterialBlock {
  vec4 u_color;
  vec4 u_params;
};

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  vec3 n = normalize(v_normal);
  vec3 L = normalize(vec3(0.35, 0.75, 0.55));
  vec3 V = normalize(u_cameraPos.xyz - v_worldPos);
  vec3 H = normalize(L + V);
  float ndl = max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, H), 0.0), max(u_params.x, 1.0)) * max(u_params.y, 0.0);
  float ambient = clamp(u_params.z, 0.0, 1.0);
  vec3 diffuse = u_color.rgb * (ambient + (1.0 - ambient) * ndl);
  vec3 color = diffuse + vec3(spec);
  fragColor = vec4(color, u_color.a);
}
`;

export const PHONG_FRAGMENT_WGSL = `
struct MaterialBlock {
  u_color : vec4f,
  u_params : vec4f,
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
  let L = normalize(vec3f(0.35, 0.75, 0.55));
  let V = normalize(camera.u_cameraPos.xyz - in.v_worldPos);
  let H = normalize(L + V);
  let ndl = max(dot(n, L), 0.0);
  let shin = max(material.u_params.x, 1.0);
  let specI = max(material.u_params.y, 0.0);
  let ambient = clamp(material.u_params.z, 0.0, 1.0);
  let spec = pow(max(dot(n, H), 0.0), shin) * specI;
  let diffuse = material.u_color.rgb * (ambient + (1.0 - ambient) * ndl);
  let color = diffuse + vec3f(spec);
  return vec4f(color, material.u_color.a);
}
`;
