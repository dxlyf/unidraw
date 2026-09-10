
// ---------------------------------------------------------------------------
// Blinn-Phong 高光材质（由场景灯光驱动）
// u_params: x=shininess, y=高光强度, z=环境光接收权重, w=保留
// ---------------------------------------------------------------------------
import { lightingGLSL, lightingWGSL } from "../lights/lightingShader.js";

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
${lightingGLSL({ specular: true })}
in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  vec3 n = normalize(v_normal);
  vec3 V = normalize(u_cameraPos.xyz - v_worldPos);
  float ambientWeight = clamp(u_params.z, 0.0, 1.0);
  vec4 lit = unidrawLighting(n, v_worldPos, V, ambientWeight);
  vec3 specular = vec3(lit.a * max(u_params.y, 0.0));
  fragColor = vec4(u_color.rgb * lit.rgb + specular, u_color.a);
}
`;

export const PHONG_FRAGMENT_WGSL = `
struct MaterialBlock {
  u_color : vec4f,
  u_params : vec4f,
};
@group(0) @binding(2) var<uniform> material : MaterialBlock;
${lightingWGSL({ specular: true })}
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
  let ambientWeight = clamp(material.u_params.z, 0.0, 1.0);
  let lit = unidrawLighting(n, in.v_worldPos, V, ambientWeight);
  let specular = vec3f(lit.a * max(material.u_params.y, 0.0));
  return vec4f(material.u_color.rgb * lit.rgb + specular, material.u_color.a);
}
`;
