/**
 * 深度回读用的可视化着色器（仅 WebGL2 后端用）。
 *
 * 为什么不能直接 `readPixels(DEPTH_COMPONENT, ...)`：Chrome 的 WebGL2 实现**没有**
 * 实现深度附件的 readPixels 路径 —— 在完全原生的上下文里试验过
 * DEPTH_COMPONENT/UNSIGNED_INT、UNSIGNED_SHORT、FLOAT 以及
 * DEPTH_STENCIL/UNSIGNED_INT_24_8 与 DEPTH_COMPONENT16/24/32F 的全部组合，
 * FBO 完整（0x8cd5）、read buffer 已设成 NONE、也没有绑定 PBO，
 * 依旧全部返回 INVALID_OPERATION（0x500），缓冲保持全 0。
 * 因为不抛异常，表现就是「深度回读静默返回 0」，比报错更难查。
 *
 * 所以走**深度 → RGBA32F 可视化**：用一个全屏三角形把深度纹理 texelFetch 到
 * rgba32float 颜色附件上（EXT_color_buffer_float 已保证可渲染），再按普通颜色
 * 纹理回读 —— 这条路在 WebGL2 上是核心能力。R 通道 = 深度，GBA = 0/0/1，
 * 与 `expandDepthToRgbaFloat` 的输出布局一致，调用方无需区分。
 *
 * 顶点着色器不依赖任何顶点缓冲：由 `gl_VertexID` 直接生成覆盖视口的三角形，
 * 因此回读路径完全不需要 VAO/属性状态。
 */
export const DEPTH_VIS_VS_GLSL = `#version 300 es
precision highp float;
uniform vec4 u_rect;   // x, y, w, h：要回读的区域（深度纹理像素坐标，GL 行序）
out vec2 v_texel;
void main() {
  // gl_VertexID = 0/1/2 → (0,0) (2,0) (0,2)：一个盖住整个视口的大三角形
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  // 目标像素 → 深度纹理像素坐标（两侧都是 GL 行序，无需翻转）
  v_texel = u_rect.xy + p * u_rect.zw;
}
`;
export const DEPTH_VIS_FS_GLSL = `#version 300 es
precision highp float;
uniform highp sampler2D u_depth;
in vec2 v_texel;
out vec4 fragColor;
void main() {
  // 深度纹理按普通 sampler2D 采样：texelFetch 的 .r 就是深度值
  float d = texelFetch(u_depth, ivec2(v_texel), 0).r;
  fragColor = vec4(d, 0.0, 0.0, 1.0);
}
`;
/**
 * 2D 数组（分层）深度纹理的版本：GLSL ES 3.0 支持 `sampler2DArray` + `texelFetch`，
 * 于是点光源 cube 阴影那种「6 层深度数组」也能逐层回读。
 *
 * cube 深度纹理没有对应写法（ES 3.0 不支持对 `samplerCube` 做 `texelFetch`），
 * 调用方会给出明确报错而不是错误数据。
 */
export const DEPTH_VIS_ARRAY_FS_GLSL = `#version 300 es
precision highp float;
uniform highp sampler2DArray u_depth;
uniform int u_layer;
in vec2 v_texel;
out vec4 fragColor;
void main() {
  float d = texelFetch(u_depth, ivec3(ivec2(v_texel), u_layer), 0).r;
  fragColor = vec4(d, 0.0, 0.0, 1.0);
}
`;
//# sourceMappingURL=depthVisualize.js.map