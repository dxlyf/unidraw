import { RenderPipeline } from "../../../resources.js";
import type { RenderPipelineDescriptor } from "../../../descriptors.js";
import { GLProgram } from "./GLProgram.js";
import { WebGL2Device } from "../WebGL2Device.js";
export declare class GLRenderPipeline extends RenderPipeline {
    readonly glProgram: GLProgram;
    readonly id: number;
    constructor(device: WebGL2Device, desc: RenderPipelineDescriptor);
    protected destroyNative(): void;
}
//# sourceMappingURL=GLRenderPipeline.d.ts.map