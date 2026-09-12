/**
 * UniformBlock —— 一个绑定到管线 bind group 的 UBO 便捷封装。
 *
 * 职责：
 * - 按 std140 布局在 CPU 侧打包 uniform 数据（Vec3/Color/Mat4/数组）；
 * - flush() 一次性写入设备 Buffer；
 * - 避免框架用户手动接触字节偏移。
 */
import type { Device } from "../device/Device.js";
import { type Buffer } from "../device/resources.js";
import type { Mat4 } from "../math/mat4.js";
import { type Color } from "../math/color.js";
import { type Std140Layout, type UniformField } from "../gpu/std140.js";
export interface UniformBlockOptions {
    label?: string;
    /** 通常从 Material/管线布局复用 */
    fields: UniformField[];
    /** 每帧重写时建议传入 */
    dynamic?: boolean;
    /**
     * 环形槽数量（> 1 时启用「动态偏移 UBO」）：
     * buffer 被划分为 slots 个对齐槽，每槽一个 block，
     * 通过 `setBindGroup(index, group, [slot * stride])` 选择实际读取的槽。
     * 用于共享材质逐物体更新矩阵的场景，避免每物体一个 buffer/bind group。
     */
    slots?: number;
}
export declare class UniformBlock {
    readonly device: Device;
    readonly layout: Std140Layout;
    readonly buffer: Buffer;
    readonly label: string | undefined;
    /** 单个槽的字节跨度（= block 大小按 minUniformBufferOffsetAlignment 对齐） */
    readonly stride: number;
    /** 槽数量（缺省 1，即普通 UBO） */
    readonly slots: number;
    private readonly _f32;
    private readonly _bytes;
    /** 环形槽的 CPU 暂存（slots × stride） */
    private readonly _staging;
    private readonly _bytesF32;
    private _pending;
    private _pendingStart;
    private _pendingEnd;
    constructor(device: Device, options: UniformBlockOptions);
    /** 字段是否声明 */
    has(name: string): boolean;
    private field;
    private indexOffset;
    setFloat(name: string, value: number): void;
    setVec2(name: string, x: number, y: number): void;
    setVec3(name: string, x: number, y: number, z: number): void;
    setVec4(name: string, x: number, y: number, z: number, w: number): void;
    setColor(name: string, color: Color): void;
    setMat4(name: string, matrix: Mat4): void;
    /** 向量/标量数组（std140 每个元素按 stride 对齐）。 */
    setArray(name: string, values: ArrayLike<number> | number[]): void;
    /** 把整块 CPU 数据写入 GPU 缓冲（槽 0 / 普通 UBO）。 */
    flush(): void;
    /**
     * 用外部按同一 std140 布局打包好的浮点数据整体覆盖本块。
     * （例如灯光：`LightsState.data` 直接倒进来，避免逐字段 setVec4）
     */
    setRaw(data: Float32Array): void;
    /**
     * 把当前 CPU 数据写入指定槽 —— **不立即上传**，只记录待写区间。
     *
     * 逐 draw 调用（配合 `flushPending()` 在提交前一次性上传）可以把
     * 「每 draw 一次 64B writeBuffer」合并成「每帧一次大写入」：
     * WebGPU 上 6000 draws 的 6000 次队列操作会降到几次，这是 draw call 压力的关键优化。
     */
    flushSlot(slot: number): void;
    /**
     * 把累积的槽位数据一次性上传（区间为 [首个待写槽, 最后一个待写槽] 的并集）。
     * 由 `BaseMaterial` 注册到 `Device.onBeforeSubmit()`，因此不需要业务代码关心。
     */
    flushPending(): void;
    /** 是否有等待上传的数据 */
    get hasPending(): boolean;
}
//# sourceMappingURL=UniformBlock.d.ts.map