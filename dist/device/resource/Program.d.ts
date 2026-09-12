import type { ProgramDescriptor } from "../descriptors.js";
import { ResourceBase } from "./ResourceBase.js";
/**
 * 着色器程序（双后端源码对：GLSL + WGSL）。
 */
export declare abstract class Program extends ResourceBase {
    /** 是否包含 WebGL2(GLSL) 源码 */
    readonly supportsWebGL2: boolean;
    /** 是否包含 WebGPU(WGSL) 源码 */
    readonly supportsWebGPU: boolean;
    readonly descriptor: ProgramDescriptor;
    constructor(desc: ProgramDescriptor);
}
//# sourceMappingURL=Program.d.ts.map