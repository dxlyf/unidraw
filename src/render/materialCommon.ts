import type { Device } from "../device/Device.js";
import type { VertexStateDescriptor } from "../device/descriptors.js";
import type { TextureFormat } from "../gpu/types.js";
import type { UniformField } from "../gpu/std140.js";
import type { MaterialOptions } from "./BaseMaterial.js";

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

export function defaultGroupEntries(): { binding: number; type: "uniform-buffer"; visibility: number; name: string }[] {
  return [
    { binding: 0, type: "uniform-buffer", visibility: VS_FRAGMENT_VISIBILITY, name: "CameraBlock" },
    { binding: 1, type: "uniform-buffer", visibility: VS_FRAGMENT_VISIBILITY, name: "ModelBlock" },
    { binding: 2, type: "uniform-buffer", visibility: VS_FRAGMENT_VISIBILITY, name: "MaterialBlock" },
  ];
}
