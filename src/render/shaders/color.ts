
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
