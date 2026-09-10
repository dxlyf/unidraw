import { RenderPipeline } from "../../../resources.js";
import type { RenderPipelineDescriptor } from "../../../descriptors.js";
import { GLBindGroupLayout } from "./GLBindGroupLayout.js";
import { GLProgram } from "./GLProgram.js";
import { WebGL2Device } from "../WebGL2Device.js";
import { nextId } from "../constants.js";

export class GLRenderPipeline extends RenderPipeline {
  readonly glProgram: GLProgram;
  readonly id: number = nextId();

  constructor(device: WebGL2Device, desc: RenderPipelineDescriptor) {
    super(desc);
    this.glProgram = desc.program as GLProgram;
    this.glProgram.linkedProgram();
    // 把每个 UBO block 绑定到其 layout 分配的 binding point
    for (const layout of desc.bindGroupLayouts) {
      const glLayout = layout as GLBindGroupLayout;
      let uboIdx = 0;
      for (const entry of layout.entries) {
        if (entry.type !== "uniform-buffer") continue;
        if (entry.name) this.glProgram.bindUniformBlock(entry.name, glLayout.uboPoints[uboIdx]!);
        uboIdx++;
      }
    }
    device.register(this);
  }

  protected destroyNative(): void {}
}
