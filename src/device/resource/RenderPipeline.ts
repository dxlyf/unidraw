import type { RenderPipelineDescriptor } from "../descriptors.js";
import { ResourceBase } from "./ResourceBase.js";

/**
 * 渲染管线句柄（program + 顶点状态 + 光栅/深度/混合 + 目标格式）。
 */
export abstract class RenderPipeline extends ResourceBase {
  readonly descriptor: RenderPipelineDescriptor;

  constructor(desc: RenderPipelineDescriptor) {
    super(desc.label);
    this.descriptor = desc;
  }
}
