/**
 * Renderer —— 面向 canvas 的极简渲染会话门面：
 * 封装 设备创建 / 逐帧 render pass（画布 + 深度）/ 提交 / 自适应尺寸。
 */
import { type CreateDeviceOptions } from "../device/createDevice.js";
import type { Device } from "../device/Device.js";
import { Color } from "../math/color.js";
import { Mat4 } from "../math/mat4.js";
import type { RenderPassEncoder } from "../command/encoder.js";
export interface RendererOptions extends CreateDeviceOptions {
    /** 背景色（hex 或 Color），默认 #0e0f13 */
    background?: string | Color;
    /** 每帧是否附带深度附件（默认 true） */
    depth?: boolean;
    /** ?debug=1 时输出日志 */
    debug?: boolean;
    /**
     * MSAA 采样数（默认 4；`1` = 关闭，超过 `device.limits.maxSamples` 自动降级）。
     *
     * 为什么默认开：几何边缘的抗锯齿在**两种后端上必须显式开启**才一致 ——
     * WebGL2 的 canvas 上下文默认 `antialias: true`（隐式 MSAA），WebGPU 的 canvas 则
     * 完全没有 MSAA。CPU 三角化出来的 2D 路径/斜线/圆弧在 WebGPU 上因此是硬锯齿，
     * 与原生 Canvas2D（永远抗锯齿）差距很大。这里统一渲染到一张 4x MSAA 离屏目标、
     * 解析后再呈现到画布，两端得到**相同**的采样数。
     */
    msaa?: number;
}
export declare class Renderer {
    readonly device: Device;
    readonly canvas: HTMLCanvasElement;
    readonly depthEnabled: boolean;
    /** 实际生效的 MSAA 采样数（1 = 关闭） */
    readonly sampleCount: number;
    private _background;
    private _encoder;
    private _pass;
    private _msaaTarget;
    private _presentPass;
    private constructor();
    static create(canvas: HTMLCanvasElement, options?: RendererOptions): Promise<Renderer>;
    /** 使用已创建的 device 包装（如 mock）。 */
    static fromDevice(device: Device, canvas: HTMLCanvasElement, options?: Omit<RendererOptions, "canvas">): Renderer;
    get background(): Color;
    setBackground(color: Color | string): this;
    /**
     * 按 CSS 尺寸 × devicePixelRatio 设置 drawing buffer。返回是否变化。
     *
     * 注意：canvas **必须有 CSS 尺寸**（例如 `width:100vw;height:100vh`）。
     * 若没有 CSS 尺寸，canvas 的显示尺寸就等于 drawing buffer 尺寸，
     * 此时再乘 devicePixelRatio 会让 buffer 每帧翻倍（无限增长、画面被推到视口外）；
     * 这种情况会跳过放大并给出一次性警告。
     */
    resizeToDisplaySize(maxPixelRatio?: number): boolean;
    /**
     * 开始一帧：创建 command encoder +（MSAA 时）离屏目标 pass，否则直接是画布 pass。
     * 完成后必须调用 endFrame()。
     */
    beginFrame(clear?: Color | string): RenderPassEncoder;
    /** 结束本帧并提交（MSAA 时先把解析结果呈现到画布）。 */
    endFrame(): void;
    private _ensureMsaaTarget;
    private _presentPassFor;
    private _presentFormat;
    private _presentFlipY;
    /** 便捷：单次帧回调。 */
    renderFrame(callback: (pass: RenderPassEncoder) => void): void;
    /** 便捷：单次帧回调 + 相机矩阵（等价 beginFrame + 手动 beginFrame(material)）。 */
    render(callback: (pass: RenderPassEncoder, time: number, dt: number) => void): void;
    private _lastTime;
    private _warnedMissingCssSize;
    destroy(): void;
}
export { Mat4 };
//# sourceMappingURL=Renderer.d.ts.map