/**
 * EffectComposer —— 后处理链。
 *
 * 职责：
 * 1. 提供一个（可选 MSAA 的）**场景渲染目标** `sceneTarget`；
 * 2. 用两张 ping-pong 目标按顺序执行效果链；
 * 3. 最后一步输出到画布（默认）或外部 `RenderTarget`。
 *
 * ```ts
 * const composer = new EffectComposer(device, { width, height, sampleCount: 4 });
 * composer.addPass(new BloomPass(device, { threshold: 0.8 }));
 * composer.addPass(new ToneMapPass(device, { mode: "aces", exposure: 1.1 }));
 *
 * // 每帧：
 * composer.render((pass) => sceneRenderer.render(pass, scene, camera));
 * // → 场景画进 sceneTarget（MSAA 自动 resolve）→ 效果链 → 画布
 * ```
 *
 * 读回结果（测试/截图）：`await composer.readOutput()`（渲染完一帧后调用）。
 */
import type { Device } from "../../device/Device.js";
import type { RenderPassEncoder } from "../../command/encoder.js";
import type { TextureFormat } from "../../gpu/types.js";
import { RenderTarget } from "../RenderTarget.js";
import type { PostEffect } from "./FullScreenPass.js";
export interface EffectComposerOptions {
    width: number;
    height: number;
    /** 链路内部格式（默认 rgba8unorm；HDR 可用 rgba16float） */
    format?: TextureFormat;
    /** 场景目标的 MSAA 采样数（默认 1；>1 时自动 resolve 后再进链） */
    sampleCount?: number;
    /** 场景目标是否需要深度（默认 true） */
    depth?: boolean;
    label?: string;
}
export declare class EffectComposer {
    readonly device: Device;
    /** 场景渲染目标（把场景画到这里，而不是画布）；`setSampleCount()` 会替换它 */
    sceneTarget: RenderTarget;
    readonly passList: PostEffect[];
    readonly format: TextureFormat;
    private _a;
    private _b;
    private _output;
    private _width;
    private _height;
    private readonly _label;
    constructor(device: Device, options: EffectComposerOptions);
    /** 追加一个效果（返回 this 便于链式） */
    addPass(effect: PostEffect): this;
    /** 在指定位置插入效果 */
    insertPass(index: number, effect: PostEffect): this;
    /** 移除并按需释放 */
    removePass(effect: PostEffect, dispose?: boolean): boolean;
    get width(): number;
    get height(): number;
    /** 尺寸变化时重建所有目标（画布 resize 后调用） */
    resize(width: number, height: number): boolean;
    /**
     * 动态修改场景目标的 MSAA 采样数（超过上限自动降级；返回是否真的变了）。
     *
     * 只重建场景目标，链路内部目标不动 —— 用于运行时切换 MSAA 的调试开关。
     */
    setSampleCount(sampleCount: number): boolean;
    /**
     * 渲染一帧：场景 → 效果链 → 输出。
     *
     * @param renderScene 把场景画进给定 pass（通常 `sceneRenderer.render(pass, scene, camera)`）
     * @param output 输出目标（缺省 = 画布；传 RenderTarget 可继续在 GPU 上使用结果）
     */
    render(renderScene: (pass: RenderPassEncoder) => void, output?: RenderTarget | null): void;
    /** 回读结果的格式（= 链路格式） */
    get outputFormat(): TextureFormat;
    private _canvasFormat;
    /** 按输出格式缓存拷贝管线（画布格式与链路格式可能不同） */
    private _copyPassFor;
    /** 渲染到内部目标并回读（测试/截图用；会额外提交一次渲染） */
    renderToPixels(renderScene: (pass: RenderPassEncoder) => void): Promise<Uint8Array>;
    dispose(): void;
    private readonly _copyPasses;
    private _makeIntermediate;
}
//# sourceMappingURL=EffectComposer.d.ts.map