/** render2d 内置着色器（纯色/渐变 + 纹理两套，GLSL/WGSL 双实现） */

// ---- 纯色 + 渐变（LUT 逐像素求值） ----
//
// 为什么用 LUT 纹理而不是「逐顶点采样颜色」：
// 顶点采样的颜色场在每个三角形内是**线性**的，而渐变（尤其是多 stop 线性、
// 以及整个圆盘都被三角化成一个多边形、所有顶点都落在圆周上的径向渐变）
// 根本不是三角形内的线性函数 —— 结果就是 stop 位置整体偏移、径向渐变
// 只画得出最外圈的颜色。改为「逐像素算 t → 查 512×1 的 LUT 纹理」后，
// t 的求值与 stop 插值都与原生 Canvas2D 一致（LUT 由浏览器自己的
// CanvasGradient 生成，连插值空间都相同），且与图元的三角化方式无关。
//
// 顶点数据（stride 64）：
// | location | 内容 |
// | --- | --- |
// | 0 | `a_pos` 设备空间坐标（CTM 之后，用于投影） |
// | 1 | `a_color` 顶点色（纯色；渐变时 = (1,1,1,globalAlpha)） |
// | 2 | `a_upos` **用户空间**坐标（渐变按用户空间求值，随 CTM 一起形变） |
// | 3 | `a_gradA` = (kind, p0.x, p0.y, p1.x)，kind: 0 纯色 / 1 线性 / 2 径向 |
// | 4 | `a_gradB` = (p1.y, c.x, c.y, r) |

export const FLAT_VS_GLSL = `#version 300 es
precision highp float;
layout(std140) uniform ViewBlock { mat4 u_viewProj; };
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a_color;
layout(location = 2) in vec2 a_upos;
layout(location = 3) in vec4 a_gradA;
layout(location = 4) in vec4 a_gradB;
out vec4 v_color;
out vec2 v_upos;
out vec4 v_gradA;
out vec4 v_gradB;
void main() {
  v_color = a_color;
  v_upos = a_upos;
  v_gradA = a_gradA;
  v_gradB = a_gradB;
  gl_Position = u_viewProj * vec4(a_pos, 0.0, 1.0);
}
`;
export const FLAT_FS_GLSL = `#version 300 es
precision highp float;
uniform sampler2D u_paintTex;
in vec4 v_color;
in vec2 v_upos;
in vec4 v_gradA;
in vec4 v_gradB;
out vec4 fragColor;

float unidrawGradientT() {
  vec2 p0 = v_gradA.yz;
  vec2 d = vec2(v_gradA.w, v_gradB.x) - p0;
  float dd = dot(d, d);
  float linearT = dd > 1e-12 ? dot(v_upos - p0, d) / dd : 0.0;
  float radialT = length(v_upos - v_gradB.yz) / max(1e-6, v_gradB.w);
  return v_gradA.x < 1.5 ? linearT : radialT;
}

void main() {
  // 注意：采样必须写在**统一控制流**里（WGSL 禁止在非一致分支里 textureSample），
  // 所以这里不做 early-return，而是先无条件采样、再按 kind 选择。
  vec4 grad = texture(u_paintTex, vec2(unidrawGradientT(), 0.5));
  vec4 gradientColor = vec4(grad.rgb, grad.a * v_color.a);
  fragColor = v_gradA.x < 0.5 ? v_color : gradientColor;
}
`;
export const FLAT_WGSL = `
struct ViewBlock { u_viewProj : mat4x4f, };
@group(0) @binding(0) var<uniform> view : ViewBlock;
@group(0) @binding(1) var u_lut : texture_2d<f32>;
@group(0) @binding(2) var u_lutSampler : sampler;

struct VSIn {
  @location(0) a_pos : vec2f,
  @location(1) a_color : vec4f,
  @location(2) a_upos : vec2f,
  @location(3) a_gradA : vec4f,
  @location(4) a_gradB : vec4f,
};
struct VSOut {
  @builtin(position) clip_pos : vec4f,
  @location(0) v_color : vec4f,
  @location(1) v_upos : vec2f,
  @location(2) v_gradA : vec4f,
  @location(3) v_gradB : vec4f,
};
@vertex fn vs_main(in : VSIn) -> VSOut {
  var out : VSOut;
  out.v_color = in.a_color;
  out.v_upos = in.a_upos;
  out.v_gradA = in.a_gradA;
  out.v_gradB = in.a_gradB;
  out.clip_pos = view.u_viewProj * vec4f(in.a_pos, 0.0, 1.0);
  return out;
}

struct FSIn {
  @builtin(position) clip_pos : vec4f,
  @location(0) v_color : vec4f,
  @location(1) v_upos : vec2f,
  @location(2) v_gradA : vec4f,
  @location(3) v_gradB : vec4f,
};
@fragment fn fs_main(in : FSIn) -> @location(0) vec4f {
  // 采样必须在统一控制流里（不能在非一致 if 内调 textureSample），
  // 所以先无条件采样、再用 select 按 kind 选结果。
  let p0 = in.v_gradA.yz;
  let d = vec2f(in.v_gradA.w, in.v_gradB.x) - p0;
  let dd = dot(d, d);
  let linearT = select(0.0, dot(in.v_upos - p0, d) / dd, dd > 1e-12);
  let radialT = length(in.v_upos - in.v_gradB.yz) / max(1e-6, in.v_gradB.w);
  let t = select(radialT, linearT, in.v_gradA.x < 1.5);
  let c = textureSample(u_lut, u_lutSampler, vec2f(t, 0.5));
  let gradientColor = vec4f(c.rgb, c.a * in.v_color.a);
  return select(gradientColor, in.v_color, in.v_gradA.x < 0.5);
}
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
uniform sampler2D u_paintTex;
in vec2 v_uv;
in vec4 v_color;
out vec4 fragColor;
void main() { fragColor = texture(u_paintTex, v_uv) * v_color; }
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
