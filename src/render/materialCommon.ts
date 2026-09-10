import type { Device } from "../device/Device.js";
import type { BindGroupLayoutEntryDescriptor, VertexStateDescriptor } from "../device/descriptors.js";
import type { TextureFormat } from "../gpu/types.js";
import type { UniformField } from "../gpu/std140.js";
import type { MaterialOptions } from "./BaseMaterial.js";
import { MAX_SHADOW_MAPS } from "./shadow/constants.js";
import { SHADOW_BLOCK_BINDING, SHADOW_SAMPLER_BINDING, SHADOW_TEXTURE_BINDING } from "./shadow/ShadowState.js";
import { shadowSamplerName, shadowTextureName } from "./shadow/shadowShaders.js";

export const CAMERA_FIELDS: UniformField[] = [
  { name: "u_viewProj", type: "mat4" },
  { name: "u_cameraPos", type: "vec4" },
];

export const MODEL_FIELDS: UniformField[] = [{ name: "u_model", type: "mat4" }];

/** u_color + u_params(x=shininess, y=spec 强度, z=ambient, w=保留) */
export const MATERIAL_FIELDS: UniformField[] = [
  { name: "u_color", type: "vec4" },
  { name: "u_params", type: "vec4" },
];

export const STANDARD_VERTEX_STATE: VertexStateDescriptor = {
  buffers: [
    {
      arrayStride: 32,
      stepMode: "vertex",
      attributes: [
        { location: 0, format: "float32x3", offset: 0 },
        { location: 1, format: "float32x3", offset: 12 },
        { location: 2, format: "float32x2", offset: 24 },
      ],
    },
  ],
};

export const VS_FRAGMENT_VISIBILITY = 3; // VERTEX | FRAGMENT

export function defaultBlendState() {
  return {
    color: { srcFactor: "src-alpha" as const, dstFactor: "one-minus-src-alpha" as const, operation: "add" as const },
    alpha: { srcFactor: "one" as const, dstFactor: "one-minus-src-alpha" as const, operation: "add" as const },
  };
}

export function depthFormatOf(_device: Device, opts: MaterialOptions): TextureFormat {
  return (opts.depthFormat ?? "depth24plus") as TextureFormat;
}

export function targetFormatOf(device: Device, opts: MaterialOptions): TextureFormat {
  if (opts.targetFormat) return opts.targetFormat;
  return (device.canvasFormat?.() ?? "rgba8unorm") as TextureFormat;
}

/**
 * 标准 group 布局：0=相机 UBO、1=模型 UBO（动态偏移，逐物体换槽）、2=材质 UBO、
 * 3=灯光 UBO（`LightsBlock`）、**6=阴影 UBO（`ShadowBlock`）+ 7..10 阴影贴图 +
 * 11..14 阴影采样器**（binding 4/5 留给具体材质自己的纹理，见 `TextureMaterial`）。
 *
 * 阴影槽位对「不用阴影的材质」同样无害：声明的 binding 全部绑定，着色器没用到
 * 就不会产生额外开销（WebGL2 只多做几次纹理绑定）。
 *
 * `options.shadows === false` 时完全不声明阴影 binding：阴影贴图 pass 用的
 * 「只写深度」材质必须这样（WebGPU 禁止「同一次提交内既把某纹理作为附件写入、
 * 又作为只读纹理资源绑定」，即使是同一个 pass 也不行）。
 */
export function defaultGroupEntries(options: { shadows?: boolean } = {}): BindGroupLayoutEntryDescriptor[] {
  const entries: BindGroupLayoutEntryDescriptor[] = [
    { binding: 0, type: "uniform-buffer", visibility: VS_FRAGMENT_VISIBILITY, name: "CameraBlock" },
    { binding: 1, type: "uniform-buffer", visibility: VS_FRAGMENT_VISIBILITY, name: "ModelBlock", hasDynamicOffset: true },
    { binding: 2, type: "uniform-buffer", visibility: VS_FRAGMENT_VISIBILITY, name: "MaterialBlock" },
    { binding: 3, type: "uniform-buffer", visibility: 2 /* FRAGMENT */, name: "LightsBlock" },
  ];
  if (options.shadows === false) return entries;
  entries.push({ binding: SHADOW_BLOCK_BINDING, type: "uniform-buffer", visibility: 2 /* FRAGMENT */, name: "ShadowBlock" });
  for (let i = 0; i < MAX_SHADOW_MAPS; i++) {
    entries.push({
      binding: SHADOW_TEXTURE_BINDING + i,
      type: "texture",
      visibility: 2,
      name: shadowTextureName(i),
      sampleType: "depth",
    });
  }
  // 采样器与纹理在 WebGL2 后端是**按顺序配对**的，所以每个阴影贴图都要有采样器条目
  for (let i = 0; i < MAX_SHADOW_MAPS; i++) {
    entries.push({ binding: SHADOW_SAMPLER_BINDING + i, type: "sampler", visibility: 2, name: shadowSamplerName(i) });
  }
  return entries;
}
