import type { BindGroupLayoutDescriptor } from "../descriptors.js";
import { ResourceBase } from "./ResourceBase.js";

/**
 * bind group 布局（binding 类型/可见性/名称约定）。
 */
export abstract class BindGroupLayout extends ResourceBase {
  readonly descriptor: BindGroupLayoutDescriptor;

  constructor(desc: BindGroupLayoutDescriptor) {
    super(desc.label);
    this.descriptor = desc;
  }

  get entries() {
    return this.descriptor.entries;
  }
}
