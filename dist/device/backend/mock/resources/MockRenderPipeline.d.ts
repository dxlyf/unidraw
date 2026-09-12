import { RenderPipeline } from "../../../resources.js";
import type { RenderPipelineDescriptor } from "../../../descriptors.js";
import { MockDevice } from "../MockDevice.js";
export declare class MockRenderPipeline extends RenderPipeline {
    constructor(device: MockDevice, desc: RenderPipelineDescriptor);
    protected destroyNative(): void;
}
//# sourceMappingURL=MockRenderPipeline.d.ts.map