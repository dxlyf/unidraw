import { RenderPipeline } from "../../../resources.js";
import type { RenderPipelineDescriptor } from "../../../descriptors.js";
import { assert } from "../../../../util/assert.js";
import { MockDevice } from "../MockDevice.js";

export class MockRenderPipeline extends RenderPipeline {
  constructor(device: MockDevice, desc: RenderPipelineDescriptor) {
    super(desc);
    assert(desc.program.supportsWebGL2 || desc.program.supportsWebGPU, "program 需要至少一种后端源码");
    assert(desc.targets.length >= 1, "pipeline 至少需要一个 color target");
    device.register(this);
  }
  protected destroyNative(): void {}
}
