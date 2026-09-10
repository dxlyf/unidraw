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
import { CopyPass } from "./CopyPass.js";
import { assert } from "../../util/assert.js";

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

export class EffectComposer {
  readonly device: Device;
  /** 场景渲染目标（把场景画到这里，而不是画布）；`setSampleCount()` 会替换它 */
  sceneTarget: RenderTarget;
  readonly passList: PostEffect[] = [];
  readonly format: TextureFormat;

  private _a: RenderTarget;
  private _b: RenderTarget;
  private _output: RenderTarget | null = null;
  private _width: number;
  private _height: number;
  private readonly _label: string;

  constructor(device: Device, options: EffectComposerOptions) {
    assert(options.width >= 1 && options.height >= 1, "EffectComposer 尺寸必须 >= 1");
    this.device = device;
    this._label = options.label ?? "composer";
    this._width = Math.floor(options.width);
    this._height = Math.floor(options.height);
    this.format = options.format ?? "rgba8unorm";
    this.sceneTarget = new RenderTarget(device, {
      width: this._width,
      height: this._height,
      format: this.format,
      depth: options.depth !== false,
      sampleCount: options.sampleCount ?? 1,
      label: `${this._label}-scene`,
    });
    this._a = this._makeIntermediate("a");
    this._b = this._makeIntermediate("b");
    // 有 MSAA 时 sceneTarget 自行 resolve；否则也需要一张普通纹理做输入（就是它自身）
    this._a.resize(this._width, this._height);
  }

  /** 追加一个效果（返回 this 便于链式） */
  addPass(effect: PostEffect): this {
    this.passList.push(effect);
    effect.resize?.(this._width, this._height);
    return this;
  }

  /** 在指定位置插入效果 */
  insertPass(index: number, effect: PostEffect): this {
    this.passList.splice(index, 0, effect);
    effect.resize?.(this._width, this._height);
    return this;
  }

  /** 移除并按需释放 */
  removePass(effect: PostEffect, dispose = true): boolean {
    const i = this.passList.indexOf(effect);
    if (i < 0) return false;
    this.passList.splice(i, 1);
    if (dispose) effect.dispose?.();
    return true;
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  /** 尺寸变化时重建所有目标（画布 resize 后调用） */
  resize(width: number, height: number): boolean {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this._width && h === this._height) return false;
    this._width = w;
    this._height = h;
    this.sceneTarget.resize(w, h);
    this._a.resize(w, h);
    this._b.resize(w, h);
    this._output?.resize(w, h);
    for (const e of this.passList) e.resize?.(w, h);
    return true;
  }

  /**
   * 动态修改场景目标的 MSAA 采样数（超过上限自动降级；返回是否真的变了）。
   *
   * 只重建场景目标，链路内部目标不动 —— 用于运行时切换 MSAA 的调试开关。
   */
  setSampleCount(sampleCount: number): boolean {
    const max = Math.max(1, this.device.limits.maxSamples ?? 1);
    const next = Math.min(Math.max(1, Math.floor(sampleCount)), max);
    if (next === this.sceneTarget.sampleCount) return false;
    const depth = this.sceneTarget.depth !== null;
    this.sceneTarget.dispose();
    this.sceneTarget = new RenderTarget(this.device, {
      width: this._width,
      height: this._height,
      format: this.format,
      depth,
      sampleCount: next,
      label: `${this._label}-scene`,
    });
    return true;
  }

  /**
   * 渲染一帧：场景 → 效果链 → 输出。
   *
   * @param renderScene 把场景画进给定 pass（通常 `sceneRenderer.render(pass, scene, camera)`）
   * @param output 输出目标（缺省 = 画布；传 RenderTarget 可继续在 GPU 上使用结果）
   */
  render(renderScene: (pass: RenderPassEncoder) => void, output?: RenderTarget | null): void {
    const encoder = this.device.createCommandEncoder(`${this._label}-frame`);

    // 1) 场景 → sceneTarget
    const scenePass = encoder.beginRenderPass({
      label: `${this._label}-scene`,
      colorAttachments: [this.sceneTarget.colorAttachment()],
      depthStencilAttachment: this.sceneTarget.depthAttachment(),
    });
    renderScene(scenePass);
    scenePass.end();

    // 2) 效果链（ping-pong）；每个效果自己开/关 pass，避免嵌套。
    //    效果管线都是按链路格式（`this.format`）创建的，因此**永远**先写进内部目标，
    //    最后再用一张「按输出格式创建」的拷贝 pass 呈现 —— 画布格式（WebGPU 常见
    //    bgra8unorm）与链路格式不同也不会管线不匹配。
    const beginOutputPass = (target: RenderTarget | null, label: string): RenderPassEncoder =>
      encoder.beginRenderPass({
        label: `${this._label}-${label}`,
        colorAttachments: [target ? target.colorAttachment() : { view: null, loadOp: "clear", storeOp: "store" }],
        depthStencilAttachment: target ? target.depthAttachment() : null,
      });

    let source = this.sceneTarget.texture;
    let target = this._a;
    for (let i = 0; i < this.passList.length; i++) {
      const effect = this.passList[i]!;
      effect.render({
        device: this.device,
        encoder,
        inputs: [source],
        width: this._width,
        height: this._height,
        output: target,
        beginOutputPass: (label) => beginOutputPass(target, label),
        format: this.format,
      });
      source = target.texture;
      target = target === this._a ? this._b : this._a;
    }

    // 3) 呈现：把链路结果（`this.format`）拷到输出目标（画布或外部 RenderTarget）
    const blit = this._copyPassFor(output ? output.format : this._canvasFormat());
    const presentPass = beginOutputPass(output ?? null, "present");
    blit.draw(presentPass, source, this._width, this._height);
    presentPass.end();

    this.device.submit([encoder.finish()]);
  }

  /** 回读结果的格式（= 链路格式） */
  get outputFormat(): TextureFormat {
    return this.format;
  }

  private _canvasFormat(): TextureFormat {
    return (this.device.canvasFormat?.() ?? "rgba8unorm") as TextureFormat;
  }

  /** 按输出格式缓存拷贝管线（画布格式与链路格式可能不同） */
  private _copyPassFor(format: TextureFormat): CopyPass {
    let pass = this._copyPasses.get(format);
    if (!pass) {
      pass = new CopyPass(this.device, format);
      this._copyPasses.set(format, pass);
    }
    return pass;
  }

  /** 渲染到内部目标并回读（测试/截图用；会额外提交一次渲染） */
  async renderToPixels(renderScene: (pass: RenderPassEncoder) => void): Promise<Uint8Array> {
    if (!this._output) {
      this._output = new RenderTarget(this.device, {
        width: this._width,
        height: this._height,
        format: this.format,
        depth: false,
        label: `${this._label}-output`,
      });
    }
    this.render(renderScene, this._output);
    return this._output.readPixels();
  }

  dispose(): void {
    for (const e of this.passList) e.dispose?.();
    this.passList.length = 0;
    this.sceneTarget.dispose();
    this._a.dispose();
    this._b.dispose();
    this._output?.dispose();
    this._output = null;
    for (const p of this._copyPasses.values()) p.dispose();
    this._copyPasses.clear();
  }

  private readonly _copyPasses = new Map<string, CopyPass>();

  private _makeIntermediate(tag: string): RenderTarget {
    return new RenderTarget(this.device, {
      width: this._width,
      height: this._height,
      format: this.format,
      depth: false,
      label: `${this._label}-${tag}`,
    });
  }
}
