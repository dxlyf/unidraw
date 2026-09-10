import type { Device } from "../../device/Device.js";
import { Texture } from "../../device/resources.js";
import { Color } from "../../math/color.js";
import { TextureUsage } from "../../gpu/types.js";

export interface PixelTextureOptions {
  label?: string;
  format?: "rgba8unorm" | "rgba8unorm-srgb";
}

export function rgbaTexture(device: Device, width: number, height: number, label: string | undefined, format: "rgba8unorm" | "rgba8unorm-srgb"): Texture {
  return device.createTexture({
    label,
    width,
    height,
    format,
    usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST,
  });
}


/** 纯色纹理（2x2，避免采样边界问题）。 */
export function createSolidTexture(device: Device, color: Color, label = "solid-texture"): Texture {
  const w = 2;
  const h = 2;
  const texture = rgbaTexture(device, w, h, label, "rgba8unorm");
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = Math.round(color.r * 255);
    rgba[i * 4 + 1] = Math.round(color.g * 255);
    rgba[i * 4 + 2] = Math.round(color.b * 255);
    rgba[i * 4 + 3] = Math.round(color.a * 255);
  }
  texture.upload(rgba);
  return texture;
}
