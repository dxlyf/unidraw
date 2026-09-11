/**
 * ShadowMap —— 一张阴影贴图（深度纹理 + 光源视投影矩阵）。
 *
 * - 只作为**深度附件**使用：`beginRenderPass({ colorAttachments: [], depthStencilAttachment: map.depthAttachment() })`
 *   （WebGPU 用 `resolveTarget` 之外的深度附件路径，WebGL2 用「无颜色附件的 FBO + drawBuffers(NONE)」）；
 * - 贴图本身可被片元着色器**采样**（`depth32float` 三后端都支持 `TEXTURE_BINDING`），
 *   着色器用 `texelFetch` / `textureLoad` 读取深度值，自己做 PCF 比较
 *   —— 这样两个后端的比较语义完全一致，也不需要「比较采样器」这种 WebGL2 没有的概念。
 *
 * 贴图池与打包由 `ShadowState` / `ShadowRenderer` 管理，业务代码通常只需要设置
 * `light.castShadow = true`。
 */

import type { Device } from "../../device/Device.js";
import type { Texture, TextureView } from "../../device/resources.js";
import type { DepthStencilAttachmentOp } from "../../command/ops.js";
import { TextureUsage } from "../../gpu/types.js";
import { Mat4 } from "../../math/mat4.js";
import type { ShadowSide } from "./ShadowSettings.js";
import { assert } from "../../util/assert.js";

/** 阴影贴图固定使用的深度格式（可采样、可渲染，三后端一致） */
export const SHADOW_DEPTH_FORMAT = "depth32float" as const;

export interface ShadowMapOptions {
  /** 池内序号（0..MAX_SHADOW_MAPS-1） */
  index: number;
  /** 边长（像素，默认 1024） */
  size?: number;
  label?: string;
}

export class ShadowMap {
  readonly device: Device;
  readonly index: number;
  readonly label: string;
  /** 光源视投影矩阵（渲染阴影贴图与着色器采样必须用同一个） */
  readonly matrix = new Mat4();
  /** 当前边长（像素） */
  size: number;
  /** 最近一次拟合的深度范围（由 `ShadowRenderer` 写入；调试/调参用） */
  nearPlane = 0;
  farPlane = 0;
  /** 一个纹素覆盖的世界尺寸（由 `ShadowRenderer` 写入） */
  texelWorld = 0;
  /** 本贴图渲染进深度图的面（由 `ShadowRenderer` 写入） */
  viewSide: ShadowSide = "back";
  /** 深度纹理（可采样） */
  texture: Texture;

  constructor(device: Device, options: ShadowMapOptions) {
    assert(options.index >= 0, "ShadowMap.index 必须 >= 0");
    this.device = device;
    this.index = options.index;
    this.label = options.label ?? `shadow-map-${options.index}`;
    this.size = Math.max(1, Math.floor(options.size ?? 1024));
    this.texture = this._createTexture(this.size);
  }

  /** 深度纹理视图（着色器采样这个） */
  view(): TextureView {
    return this.texture.view();
  }

  /** 深度附件描述（loadOp=clear，清成 1 = 最远） */
  depthAttachment(options: { clearValue?: number } = {}): DepthStencilAttachmentOp {
    return {
      view: this.texture.view(),
      depthLoadOp: "clear",
      depthStoreOp: "store",
      depthClearValue: options.clearValue ?? 1,
      sampleCount: 1,
    };
  }

  /** 改边长（返回是否真的重建了；材质侧的 bind group 由 `ShadowState.version` 驱动重建） */
  resize(size: number): boolean {
    const next = Math.max(1, Math.floor(size));
    if (next === this.size) return false;
    this.texture.destroy();
    this.size = next;
    this.texture = this._createTexture(next);
    return true;
  }

  dispose(): void {
    this.texture.destroy();
  }

  private _createTexture(size: number): Texture {
    return this.device.createTexture({
      label: `${this.label}-depth`,
      width: size,
      height: size,
      format: SHADOW_DEPTH_FORMAT,
      usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.TEXTURE_BINDING,
    });
  }
}
