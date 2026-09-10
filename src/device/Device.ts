import { assert } from "../util/assert.js";
import { logger } from "../util/logger.js";
import { CommandEncoder, type CommandBuffer } from "../command/encoder.js";
import type { CommandOp } from "../command/ops.js";
import type {
  BindGroupDescriptor,
  BindGroupLayoutDescriptor,
  BufferDescriptor,
  ProgramDescriptor,
  RenderPipelineDescriptor,
  SamplerDescriptor,
  TextureDescriptor,
} from "./descriptors.js";
import {
  BindGroup,
  BindGroupLayout,
  Buffer,
  Program,
  RenderPipeline,
  ResourceBase,
  Sampler,
  Texture,
} from "./resources.js";
import type { BackendKind, TextureFormat } from "../gpu/types.js";

export interface DeviceInfo {
  kind: BackendKind;
  /** 人类可读名称，例如 "WebGL2 (ANGLE ...)" */
  name: string;
  /** GPU 厂商/设备字符串（尽力而为） */
  adapter?: string;
}

export interface DeviceLimits {
  maxVertexAttributes: number;
  maxTextureUnits: number;
  maxUniformBufferBindings: number;
  maxTextureSize: number;
  maxCanvasSize?: number;
}

/**
 * 统一设备抽象：创建资源、编码并提交命令。
 *
 * 三种实现：
 * - WebGL2Device —— 同步 API 后端
 * - WebGPUDevice —— 异步 API 后端
 * - MockDevice   —— 无头 CPU 后端（测试 / SSR）
 */
export abstract class Device extends ResourceBase {
  readonly kind: BackendKind;
  readonly canvas: HTMLCanvasElement | null;
  readonly info: DeviceInfo;
  private readonly _resources: ResourceBase[] = [];

  protected constructor(kind: BackendKind, canvas: HTMLCanvasElement | null, info: DeviceInfo) {
    super(info.name);
    this.kind = kind;
    this.canvas = canvas;
    this.info = info;
  }

  // -------------------------------------------------------------------------
  // 资源创建（由后端实现）
  // -------------------------------------------------------------------------

  abstract get limits(): DeviceLimits;

  abstract createBuffer(desc: BufferDescriptor): Buffer;
  abstract createTexture(desc: TextureDescriptor): Texture;
  abstract createSampler(desc: SamplerDescriptor): Sampler;
  abstract createProgram(desc: ProgramDescriptor): Program;
  abstract createBindGroupLayout(desc: BindGroupLayoutDescriptor): BindGroupLayout;
  abstract createBindGroup(desc: BindGroupDescriptor): BindGroup;
  abstract createRenderPipeline(desc: RenderPipelineDescriptor): RenderPipeline;

  /** 创建命令编码器（与后端无关的通用实现）。 */
  createCommandEncoder(label?: string): CommandEncoder {
    return new CommandEncoder(label);
  }

  // -------------------------------------------------------------------------
  // 提交
  // -------------------------------------------------------------------------

  /**
   * 提交命令缓冲。WebGL2 同步执行；WebGPU 异步执行；
   * Mock 在 CPU 状态模型上执行。可提交同一 CommandBuffer 多次（重放）。
   */
  submit(commandBuffers: readonly CommandBuffer[]): void {
    assert(!this.destroyed, "Device 已销毁，无法 submit");
    for (const buffer of commandBuffers) {
      this.executeOps(buffer.ops);
    }
  }

  /** 等待本次提交的 GPU 工作完成。WebGL2/Mock 立即/下一微任务完成。 */
  abstract onSubmittedWorkDone(): Promise<void>;

  /** canvas 后备缓冲尺寸（未创建 canvas 的 Mock 返回 {width:0,height:0}）。 */
  abstract presentSize(): { width: number; height: number };

  /** canvas 颜色格式；无 canvas 时返回 null。 */
  abstract canvasFormat(): TextureFormat | null;

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------

  /**
   * 登记资源到设备生命周期（设备销毁时统一释放）。
   * @internal 由后端资源构造函数调用
   */
  register<T extends ResourceBase>(resource: T): T {
    this._resources.push(resource);
    return resource;
  }

  /** 由后端实现：把统一命令翻译为原生调用。 */
  protected abstract executeOps(ops: readonly CommandOp[]): void;

  override destroy(): void {
    if (this.destroyed) return;
    this.markDestroyed();
    for (const r of this._resources) {
      if (!r.destroyed) r.destroy();
    }
    this._resources.length = 0;
    this.destroyNative();
    logger.info(`device "${this.info.name}" 已销毁`);
  }

  protected abstract override destroyNative(): void;
}

/** 打印渲染统计（提交缓冲数等）的辅助类型，保留给调试面板使用。 */
export interface SubmitStats {
  commandBuffers: number;
  ops: number;
}
