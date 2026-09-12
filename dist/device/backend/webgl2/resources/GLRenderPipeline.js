import { RenderPipeline } from "../../../resources.js";
import { nextId } from "../constants.js";
export class GLRenderPipeline extends RenderPipeline {
    glProgram;
    id = nextId();
    constructor(device, desc) {
        super(desc);
        this.glProgram = desc.program;
        this.glProgram.linkedProgram();
        // 把每个 UBO block 绑定到其 layout 分配的 binding point
        for (const layout of desc.bindGroupLayouts) {
            const glLayout = layout;
            let uboIdx = 0;
            for (const entry of layout.entries) {
                if (entry.type !== "uniform-buffer")
                    continue;
                if (entry.name)
                    this.glProgram.bindUniformBlock(entry.name, glLayout.uboPoints[uboIdx]);
                uboIdx++;
            }
        }
        device.register(this);
    }
    destroyNative() { }
}
//# sourceMappingURL=GLRenderPipeline.js.map