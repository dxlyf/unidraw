import { BindGroupLayout } from "../../../resources.js";
import type { BindGroupLayoutDescriptor } from "../../../descriptors.js";
import { WebGL2Device } from "../WebGL2Device.js";
export declare class GLBindGroupLayout extends BindGroupLayout {
    /** uniform-buffer entry 的 binding point（数组与 layout 中 UBO entry 顺序对齐） */
    readonly uboPoints: number[];
    /** texture entry 的纹理单元（与 texture entry 顺序对齐） */
    readonly textureUnits: number[];
    private readonly _device;
    constructor(device: WebGL2Device, desc: BindGroupLayoutDescriptor);
    protected destroyNative(): void;
}
//# sourceMappingURL=GLBindGroupLayout.d.ts.map