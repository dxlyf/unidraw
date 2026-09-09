import type {
  BindGroupDescriptor,
  BindGroupLayoutDescriptor,
  BufferDescriptor,
  ProgramDescriptor,
  RenderPipelineDescriptor,
  SamplerDescriptor,
  TextureDescriptor,
  TextureUploadOptions,
} from "./descriptors.js";
import type { BufferUsageFlags, TextureFormat, TextureUsageFlags } from "../gpu/types.js";
import { assert } from "../util/assert.js";

/** 公共资源基类：统一生命周期（destroy 幂等）。 */
export abstract class ResourceBase {
  readonly label: string | undefined;
  private _destroyed = false;

  constructor(label?: string) {
    this.label = label;
  }

  get destroyed(): boolean {
    return this._destroyed;
  }

  protected markDestroyed(): void {
    this._destroyed = true;
  }

  /** 释放后端资源；幂等。 */
  abstract destroy(): void;
}

// ---------------------------------------------------------------------------
// Buffer
// ---------------------------------------------------------------------------

export abstract class Buffer extends ResourceBase {
  readonly size: number;
  readonly usage: BufferUsageFlags;

  constructor(desc: BufferDescriptor) {
    super(desc.label);
    this.size = desc.size;
    this.usage = desc.usage;
  }

  /**
   * 写入数据（通常用于每帧更新 uniform）。
   * data 超出 size 的部分会被裁剪/断言。
   */
  abstract write(data: ArrayBufferView | ArrayBuffer, offset?: number): void;

  override destroy(): void {
    if (this.destroyed) return;
    this.markDestroyed();
    this.destroyNative();
  }

  protected abstract destroyNative(): void;
}

// ---------------------------------------------------------------------------
// Texture / TextureView
// ---------------------------------------------------------------------------

export abstract class Texture extends ResourceBase {
  readonly width: number;
  readonly height: number;
  readonly format: TextureFormat;
  readonly usage: TextureUsageFlags;
  private _view: TextureView | null = null;

  constructor(desc: TextureDescriptor) {
    super(desc.label);
    this.width = desc.width;
    this.height = desc.height;
    this.format = desc.format;
    this.usage = desc.usage;
  }

  /** 获取默认视图（mip 0 / layer 0）。 */
  view(): TextureView {
    if (!this._view) this._view = this.createDefaultView();
    return this._view;
  }

  protected abstract createDefaultView(): TextureView;

  /** 上传像素数据（支持子区域）。 */
  abstract upload(data: ArrayBufferView, options?: TextureUploadOptions): void;

  /** 生成 mipmap（WebGPU 需 COPY_SRC|COPY_DST；WebGL2 需 mipLevelCount>1）。 */
  abstract generateMipmaps(): void;

  override destroy(): void {
    if (this.destroyed) return;
    this.markDestroyed();
    if (this._view) this._view.destroy();
    this._view = null;
    this.destroyNative();
  }

  protected abstract destroyNative(): void;
}

/** 纹理视图：v1 仅支持整幅 2D（mip 0, layer 0）。null view 由后端解释为 canvas。 */
export abstract class TextureView extends ResourceBase {
  readonly texture: Texture;

  constructor(texture: Texture) {
    super(texture.label);
    this.texture = texture;
  }

  override destroy(): void {
    if (this.destroyed) return;
    // 视图不拥有底层纹理；仅作引用，不在此销毁原生对象
    this.markDestroyed();
  }
}

// ---------------------------------------------------------------------------
// Sampler
// ---------------------------------------------------------------------------

export abstract class Sampler extends ResourceBase {
  readonly descriptor: SamplerDescriptor;

  constructor(desc: SamplerDescriptor) {
    super(desc.label);
    this.descriptor = { ...desc };
  }

  override destroy(): void {
    if (this.destroyed) return;
    this.markDestroyed();
    this.destroyNative();
  }

  protected abstract destroyNative(): void;
}

// ---------------------------------------------------------------------------
// Program（着色器程序，双后端源码对）
// ---------------------------------------------------------------------------

export abstract class Program extends ResourceBase {
  /** 是否可用于指定后端 */
  readonly supportsWebGL2: boolean;
  readonly supportsWebGPU: boolean;
  readonly descriptor: ProgramDescriptor;

  constructor(desc: ProgramDescriptor) {
    super(desc.label);
    assert(desc.glsl || desc.wgsl, "Program 至少需要 glsl 或 wgsl 源码之一");
    this.descriptor = desc;
    this.supportsWebGL2 = desc.glsl !== undefined;
    this.supportsWebGPU = desc.wgsl !== undefined;
  }

  override destroy(): void {
    if (this.destroyed) return;
    this.markDestroyed();
    this.destroyNative();
  }

  protected abstract destroyNative(): void;
}

// ---------------------------------------------------------------------------
// BindGroupLayout / BindGroup
// ---------------------------------------------------------------------------

export abstract class BindGroupLayout extends ResourceBase {
  readonly descriptor: BindGroupLayoutDescriptor;

  constructor(desc: BindGroupLayoutDescriptor) {
    super(desc.label);
    this.descriptor = desc;
  }

  get entries() {
    return this.descriptor.entries;
  }

  override destroy(): void {
    if (this.destroyed) return;
    this.markDestroyed();
    this.destroyNative();
  }

  protected abstract destroyNative(): void;
}

export abstract class BindGroup extends ResourceBase {
  readonly descriptor: BindGroupDescriptor;

  constructor(desc: BindGroupDescriptor) {
    super(desc.label);
    this.descriptor = desc;
  }

  override destroy(): void {
    if (this.destroyed) return;
    this.markDestroyed();
    this.destroyNative();
  }

  protected abstract destroyNative(): void;
}

// ---------------------------------------------------------------------------
// RenderPipeline
// ---------------------------------------------------------------------------

export abstract class RenderPipeline extends ResourceBase {
  readonly descriptor: RenderPipelineDescriptor;

  constructor(desc: RenderPipelineDescriptor) {
    super(desc.label);
    this.descriptor = desc;
  }

  override destroy(): void {
    if (this.destroyed) return;
    this.markDestroyed();
    this.destroyNative();
  }

  protected abstract destroyNative(): void;
}

export type { SamplerDescriptor };
