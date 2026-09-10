
// ---------------------------------------------------------------------------
// 颜色材质（Lambert 漫反射，由场景灯光驱动）
// ---------------------------------------------------------------------------
import { lightingGLSL, lightingWGSL } from "../lights/lightingShader.js";

export const COLOR_FRAGMENT_GLSL = `#version 300 es
precision highp float;

layout(std140) uniform CameraBlock {
  mat4 u_viewProj;
  vec4 u_cameraPos;
};
layout(std140) uniform MaterialBlock {
  vec4 u_color;
  vec4 u_params;
};
${lightingGLSL({ specular: false })}
in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  vec3 n = normalize(v_normal);
  vec3 V = normalize(u_cameraPos.xyz - v_worldPos);
  vec4 lit = unidrawLighting(n, v_worldPos, V, 1.0);
  fragColor = vec4(u_color.rgb * lit.rgb, u_color.a);
}
`;

export const COLOR_FRAGMENT_WGSL = `
struct MaterialBlock {
  u_color : vec4f,
  u_params : vec4f,
};
@group(0) @binding(2) var<uniform> material : MaterialBlock;
${lightingWGSL({ specular: false })}
struct FSIn {
  @builtin(position) clip_pos : vec4f,
  @location(0) v_worldPos : vec3f,
  @location(1) v_normal : vec3f,
  @location(2) v_uv : vec2f,
};

@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  let n = normalize(in.v_normal);
  let V = normalize(camera.u_cameraPos.xyz - in.v_worldPos);
  let lit = unidrawLighting(n, in.v_worldPos, V, 1.0);
  return vec4f(material.u_color.rgb * lit.rgb, material.u_color.a);
}
`;
