import { Buffer, Sampler, TextureView } from "../../resources.js";
import type { BindGroupResource } from "../../descriptors.js";
import { assert } from "../../../util/assert.js";

export function assertResourceType(type: "uniform-buffer" | "texture" | "sampler", resource: BindGroupResource, binding: number): void {
  if (type === "uniform-buffer") assert(resource instanceof Buffer, `binding ${binding} 应为 Buffer（uniform）`);
  else if (type === "sampler") assert(resource instanceof Sampler, `binding ${binding} 应为 Sampler`);
  else assert(resource instanceof TextureView, `binding ${binding} 应为 TextureView`);
}

export function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}
