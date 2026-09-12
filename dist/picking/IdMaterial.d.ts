import type { Device } from "../device/Device.js";
import type { BindGroup } from "../device/resources.js";
import type { Color } from "../math/color.js";
import type { UniformField } from "../gpu/std140.js";
import { BaseMaterial } from "../render/BaseMaterial.js";
import type { MaterialOptions } from "../render/BaseMaterial.js";
export declare const ID_FIELDS: UniformField[];
/** 物体编号 → ID 颜色（0..255 分量，按 R/G/B 低位到高位编码）。 */
export declare function encodeId(id: number): [number, number, number];
/** ID 颜色 → 物体编号（`encodeId` 的逆运算）。 */
export declare function decodeId(r: number, g: number, b: number): number;
/**
 * 拾取用 ID 材质：把「物体编号」编码成颜色直接写入离屏目标。
 *
 * - 每个物体在 ID pass 里占一个「动态偏移槽」写入自己的 ID（binding 3），
 *   因此**一个材质实例**就能绘制全部物体（不需要每物体一个材质/UBO/管线）；
 * - 相机/模型使用与其它材质相同的标准布局（binding 0/1），
 *   所以深度测试、剔除行为与正式渲染完全一致。
 */
export declare class IdMaterial extends BaseMaterial {
    /** ID 环形块与模型矩阵环形块保持同容量 */
    private _idBlock;
    private _idSlotCount;
    private _idColor;
    private _id;
    /** 逐 draw 复用的动态偏移数组 */
    private readonly _extraOffsets;
    constructor(device: Device, opts?: MaterialOptions);
    /** 当前物体编号（0 = 背景/未使用） */
    get id(): number;
    /** 设置下一个绘制的物体编号（1 起；0 保留给背景）。 */
    setId(id: number): this;
    /** 直接设置 ID 颜色（0..1，调试用）。 */
    setIdColor(color: Color): this;
    protected createBindGroup(): BindGroup;
    protected extraDynamicOffsets(slot: number): readonly number[];
    private growIdRing;
}
//# sourceMappingURL=IdMaterial.d.ts.map