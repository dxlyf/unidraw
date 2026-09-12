/**
 * ShadowResources —— 每个 `Device` 一份的阴影公共资源（WeakMap 缓存）。
 *
 * 为什么共享：所有受光材质都在同一个 bind group layout 里声明
 * `ShadowBlock` + 4 张阴影贴图 + 4 个采样器（binding 6..14），
 * 如果每个材质各持一份 UBO / 占位纹理，材质一多就会浪费显存与纹理单元。
 * 共享后：
 * - `block`：唯一的阴影 UBO，每帧由 `ShadowRenderer` 写一次；
 * - `maps`：惰性创建的贴图池（首次出现投影灯时创建，之后复用）；
 * - `placeholder`：没有阴影时的 1x1 深度占位纹理（保证 bind group 完整）；
 * - `version`：池/尺寸变化时自增，材质据此重建 bind group。
 */
import type { Device } from "../../device/Device.js";
import type { Sampler, Texture } from "../../device/resources.js";
import { UniformBlock } from "../UniformBlock.js";
import { ShadowMap } from "./ShadowMap.js";
import { ShadowState } from "./ShadowState.js";
export declare class ShadowResources {
    readonly device: Device;
    /** 阴影 UBO（binding 6，全设备共享） */
    readonly block: UniformBlock;
    /** 打包缓冲（每帧 fill） */
    readonly state: ShadowState;
    /** 贴图池（长度 = MAX_SHADOW_MAPS；惰性创建） */
    readonly maps: ShadowMap[];
    /** 深度贴图采样器（NEAREST + CLAMP；WebGL2 绑到纹理单元上，保证深度纹理「完整」） */
    readonly sampler: Sampler;
    /** 池/尺寸变化计数：材质发现变化后重建 bind group */
    version: number;
    private _placeholder;
    constructor(device: Device);
    /** 占位深度纹理（1x1，未使用的 shadow 槽位绑它） */
    get placeholder(): Texture;
    /** 取第 i 张阴影贴图（不存在则创建；`size` 变化时重建） */
    acquire(index: number, size: number): ShadowMap;
    /**
     * 绑定到材质 bind group 的阴影贴图视图（未使用的槽位用占位纹理）。
     * 顺序与 `SHADOW_TEXTURE_BINDING + i` 一致。
     */
    mapView(index: number): import("../../device/resources.js").TextureView;
    /** 把当前 `state` 写入共享 UBO（每帧由 `ShadowRenderer` 调一次） */
    flushBlock(): void;
    dispose(): void;
}
/** 取（或创建）该设备的阴影公共资源 */
export declare function shadowResources(device: Device): ShadowResources;
/** 释放该设备的阴影公共资源（`device.destroy()` 之后调用或由 GC 兜底） */
export declare function disposeShadowResources(device: Device): void;
//# sourceMappingURL=ShadowResources.d.ts.map