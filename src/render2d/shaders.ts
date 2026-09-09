/** render2d 内置着色器（纯色 + 纹理两套，GLSL/WGSL 双实现） */

// ---- 纯色（顶点色） ----

export const FLAT_VS_GLSL = `#version 300 es
precision highp float;
layout(std140) uniform ViewBlock { mat4 u_viewProj; };
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a_color;
out vec4 v_color;
void main() {
  v_color = a_color;
  gl_Position = u_viewProj * vec4(a_pos, 0.0, 1.0);
}
`;
export const FLAT_FS_GLSL = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 fragColor;
void main() { fragColor = v_color; }
`;
export const FLAT_WGSL = `
struct ViewBlock { u_viewProj : mat4x4f, };
@group(0) @binding(0) var<uniform> view : ViewBlock;
struct VSIn { @location(0) a_pos : vec2f, @location(1) a_color : vec4f, };
struct VSOut { @builtin(position) clip_pos : vec4f, @location(0) v_color : vec4f, };
@vertex fn vs_main(in : VSIn) -> VSOut {
  var out : VSOut;
  out.v_color = in.a_color;
  out.clip_pos = view.u_viewProj * vec4f(in.a_pos, 0.0, 1.0);
  return out;
}
struct FSIn { @builtin(position) clip_pos : vec4f, @location(0) v_color : vec4f, };
@fragment fn fs_main(in : FSIn) -> @location(0) vec4f { return in.v_color; }
`;

// ---- 纹理（文字/位图）：颜色 = 采样色 × 顶点色 ----

export const TEX_VS_GLSL = `#version 300 es
precision highp float;
layout(std140) uniform ViewBlock { mat4 u_viewProj; };
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec4 a_color;
out vec2 v_uv;
out vec4 v_color;
void main() {
  v_uv = a_uv;
  v_color = a_color;
  gl_Position = u_viewProj * vec4(a_pos, 0.0, 1.0);
}
`;
export const TEX_FS_GLSL = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
in vec2 v_uv;
in vec4 v_color;
out vec4 fragColor;
void main() { fragColor = texture(u_tex, v_uv) * v_color; }
`;
export const TEX_WGSL = `
struct ViewBlock { u_viewProj : mat4x4f, };
@group(0) @binding(0) var<uniform> view : ViewBlock;
@group(0) @binding(1) var u_tex : texture_2d<f32>;
@group(0) @binding(2) var u_texSampler : sampler;
struct VSIn {
  @location(0) a_pos : vec2f,
  @location(1) a_uv : vec2f,
  @location(2) a_color : vec4f,
};
struct VSOut { @builtin(position) clip_pos : vec4f, @location(0) v_uv : vec2f, @location(1) v_color : vec4f, };
@vertex fn vs_main(in : VSIn) -> VSOut {
  var out : VSOut;
  out.v_uv = in.a_uv;
  out.v_color = in.a_color;
  out.clip_pos = view.u_viewProj * vec4f(in.a_pos, 0.0, 1.0);
  return out;
}
struct FSIn { @builtin(position) clip_pos : vec4f, @location(0) v_uv : vec2f, @location(1) v_color : vec4f, };
@fragment fn fs_main(in : FSIn) -> @location(0) vec4f {
  return textureSample(u_tex, u_texSampler, in.v_uv) * in.v_color;
}
`;
