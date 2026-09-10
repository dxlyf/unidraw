
// ---------------------------------------------------------------------------
// 纯色无光照（unlit）
// ---------------------------------------------------------------------------
export const UNLIT_FRAGMENT_GLSL = `#version 300 es
precision highp float;

layout(std140) uniform MaterialBlock {
  vec4 u_color;
};

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  fragColor = u_color;
}
`;

export const UNLIT_FRAGMENT_WGSL = `
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
  return material.u_color;
}
`;
