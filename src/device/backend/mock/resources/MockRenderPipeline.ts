import { RenderPipeline } from "../../../resources.js";
import type { RenderPipelineDescriptor } from "../../../descriptors.js";
import { assert } from "../../../../util/assert.js";
import { MockDevice } from "../MockDevice.js";

export class MockRenderPipeline extends RenderPipeline {
  constructor(device: MockDevice, desc: RenderPipelineDescriptor) {
    super(desc);
    assert(desc.program.supportsWebGL2 || desc.program.supportsWebGPU, "program 需要至少一种后端源码");
    assert(
      desc.targets.length >= 1 || desc.depthStencil != null,
      "pipeline 需要至少一个 color target 或深度附件（只写深度的 pass 用后者）",
    );
    device.register(this);
  }
  protected destroyNative(): void {}
}
