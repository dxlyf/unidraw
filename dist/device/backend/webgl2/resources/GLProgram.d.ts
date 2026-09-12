import { Program } from "../../../resources.js";
import type { ProgramDescriptor } from "../../../descriptors.js";
import type { GL } from "../glUtils.js";
import { WebGL2Device } from "../WebGL2Device.js";
export declare class GLProgram extends Program {
    readonly gl: GL;
    private _program;
    private readonly _locations;
    private readonly _blockIndex;
    constructor(device: WebGL2Device, desc: ProgramDescriptor);
    /** 延迟链接，链接后缓存 uniform/UBO 信息。 */
    linkedProgram(): WebGLProgram;
    uniformLocation(name: string): WebGLUniformLocation | null;
    bindUniformBlock(name: string, point: number): void;
    protected destroyNative(): void;
}
//# sourceMappingURL=GLProgram.d.ts.map