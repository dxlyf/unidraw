import { assert } from "../../util/assert.js";
import type { ProgramDescriptor } from "../descriptors.js";
import { ResourceBase } from "./ResourceBase.js";

/**
 * 着色器程序（双后端源码对：GLSL + WGSL）。
 */
export abstract class Program extends ResourceBase {
  /** 是否包含 WebGL2(GLSL) 源码 */
  readonly supportsWebGL2: boolean;
  /** 是否包含 WebGPU(WGSL) 源码 */
  readonly supportsWebGPU: boolean;
  readonly descriptor: ProgramDescriptor;

  constructor(desc: ProgramDescriptor) {
    super(desc.label);
    assert(desc.glsl || desc.wgsl, "Program 至少需要 glsl 或 wgsl 源码之一");
    this.descriptor = desc;
    this.supportsWebGL2 = desc.glsl !== undefined;
    this.supportsWebGPU = desc.wgsl !== undefined;
  }
}
