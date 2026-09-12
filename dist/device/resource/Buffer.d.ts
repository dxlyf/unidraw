import type { BufferUsageFlags } from "../../gpu/types.js";
import type { BufferDescriptor } from "../descriptors.js";
import { ResourceBase } from "./ResourceBase.js";
/**
 * 顶点/索引/uniform/… 缓冲句柄。
 */
export declare abstract class Buffer extends ResourceBase {
    readonly size: number;
    readonly usage: BufferUsageFlags;
    constructor(desc: BufferDescriptor);
    /**
     * 写入数据（通常用于每帧更新 uniform）。
     * 超出 size 的写入会被后端校验（WebGPU 抛错 / WebGL2 产生 GL 错误）。
     */
    abstract write(data: ArrayBufferView | ArrayBuffer, offset?: number): void;
}
//# sourceMappingURL=Buffer.d.ts.map