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
//# sourceMappingURL=blit.js.map