
// ---------------------------------------------------------------------------
// 纹理材质片元（纹理 × 颜色 × 场景灯光）
// 布局：0/1/2 标准块，3 = LightsBlock，4 = texture，5 = sampler
// ---------------------------------------------------------------------------
import { lightingGLSL, lightingWGSL } from "../lights/lightingShader.js";

export const TEXTURE_FRAGMENT_GLSL = `#version 300 es
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
uniform sampler2D u_albedo;

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  vec4 albedo = texture(u_albedo, v_uv) * u_color;
  vec3 n = normalize(v_normal);
  vec3 V = normalize(u_cameraPos.xyz - v_worldPos);
  vec4 lit = unidrawLighting(n, v_worldPos, V, 1.0);
  fragColor = vec4(albedo.rgb * lit.rgb, albedo.a);
}
`;

export const TEXTURE_FRAGMENT_WGSL = `
struct MaterialBlock {
  u_color : vec4f,
  u_params : vec4f,
};
@group(0) @binding(2) var<uniform> material : MaterialBlock;
${lightingWGSL({ specular: false })}
@group(0) @binding(4) var u_albedo : texture_2d<f32>;
@group(0) @binding(5) var u_albedoSampler : sampler;

struct FSIn {
  @builtin(position) clip_pos : vec4f,
  @location(0) v_worldPos : vec3f,
  @location(1) v_normal : vec3f,
  @location(2) v_uv : vec2f,
};

@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  let albedo = textureSample(u_albedo, u_albedoSampler, in.v_uv) * material.u_color;
  let n = normalize(in.v_normal);
  let V = normalize(camera.u_cameraPos.xyz - in.v_worldPos);
  let lit = unidrawLighting(n, in.v_worldPos, V, 1.0);
  return vec4f(albedo.rgb * lit.rgb, albedo.a);
}
`;
