import type { BindGroupDescriptor } from "../descriptors.js";
import { ResourceBase } from "./ResourceBase.js";

/**
 * bind group（一组绑定资源的快照；内容变化需重建）。
 */
export abstract class BindGroup extends ResourceBase {
  readonly descriptor: BindGroupDescriptor;

  constructor(desc: BindGroupDescriptor) {
    super(desc.label);
    this.descriptor = desc;
  }
}
