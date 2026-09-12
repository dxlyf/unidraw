import { Buffer } from "../../../resources.js";
import type { BufferDescriptor } from "../../../descriptors.js";
import type { GL } from "../glUtils.js";
import { WebGL2Device } from "../WebGL2Device.js";
export declare class GLBuffer extends Buffer {
    readonly glBuffer: WebGLBuffer;
    readonly gl: GL;
    readonly id: number;
    private readonly _target;
    private readonly _device;
    constructor(device: WebGL2Device, desc: BufferDescriptor);
    write(data: ArrayBufferView | ArrayBuffer, offset?: number): void;
    /**
     * 在「不与任何 VAO 的索引绑定冲突」的前提下执行 buffer 操作。
     *
     * WebGL2 里 `ELEMENT_ARRAY_BUFFER` 的绑定是 **VAO 状态**：直接 `bindBuffer` 会把
     * 当前 VAO 的索引缓冲区改掉。而框架的 VAO 是**缓存复用**的（`_vaos`，创建一次后
     * 不再重建），于是「先写 A 的索引、再写 B 的索引」会把 A 的 VAO 指到 B 的索引缓冲区上，
     * 后续 drawElements 读到越界索引（恒为 0）→ 三角形退化 → 整批绘制凭空消失。
     *
     * 典型触发场景：Canvas2D 一帧里同时有「彩色图形（flat）」和「文本（glyph）」两套
     * 顶点/索引缓冲，`flush()` 先写 flat 再写 text，于是所有彩色图形在 WebGL2 上都不见了
     * （WebGPU 没有 VAO，绑定索引缓冲不是持久状态，所以不受影响）。
     *
     * 规避方式：先把 VAO 解绑到默认 VAO（0）再改索引绑定，写完恢复原来的 VAO ——
     * 默认 VAO 框架从不用于绘制，因此不会破坏任何缓存的 VAO。
     */
    private elementBindingSafe;
    protected destroyNative(): void;
}
//# sourceMappingURL=GLBuffer.d.ts.map