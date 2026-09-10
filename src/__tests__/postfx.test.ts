/**
 * 后处理单元测试：RenderTarget / EffectComposer / 呈现 blit / MSAA 降级。
 *
 * Mock 后端不栅格化，但会**校验管线与附件的颜色格式是否匹配**（`setPipeline` 时），
 * 并记录每个 pass 的 draw —— 因此可以精确断言：
 * - 效果链的 ping-pong 顺序与输入纹理；
 * - 「链内永远是链路格式，最后由一趟按输出格式创建的拷贝 pass 呈现」这条规则
 *   （画布格式与链路格式不同时也能通过校验）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockDevice } from "../device/createDevice.js";
import type { MockDevice } from "../device/backend/mock/MockDevice.js";
import { RenderTarget } from "../render/RenderTarget.js";
import { EffectComposer } from "../render/postfx/EffectComposer.js";
import { CopyPass, GrayscalePass, ToneMapPass } from "../render/postfx/index.js";
import type { PostEffect, PostEffectContext } from "../render/postfx/FullScreenPass.js";
import type { RenderPassEncoder } from "../command/encoder.js";
import { TextureUsage } from "../gpu/types.js";
import type { Texture } from "../device/resources.js";

/** 桩效果：只记录上下文，pass 由 composer 提供的 `beginOutputPass()` 打开 */
class StubEffect implements PostEffect {
  readonly name: string;
  readonly inputCount = 1;
  calls: {
    inputs: readonly Texture[];
    targetTexture: Texture | null;
    targetFormat: string;
    format: string;
    label: string;
  }[] = [];
  resizes: [number, number][] = [];
  disposed = false;

  constructor(name: string) {
    this.name = name;
  }

  render(ctx: PostEffectContext): void {
    const pass: RenderPassEncoder = ctx.beginOutputPass(this.name);
    const target = ctx.output;
    this.calls.push({
      inputs: ctx.inputs,
      targetTexture: target ? target.texture : null,
      targetFormat: target ? (target.colorAttachment().view?.texture.format ?? "") : "canvas",
      format: ctx.format,
      label: pass.label ?? "",
    });
    pass.end();
  }

  resize(width: number, height: number): void {
    this.resizes.push([width, height]);
  }

  dispose(): void {
    this.disposed = true;
  }
}

const noopScene = (): void => {};

test("RenderTarget：尺寸/格式/附件描述与 resize 语义", () => {
  const device = createMockDevice();
  const rt = new RenderTarget(device, { width: 32, height: 16, format: "rgba8unorm", label: "t" });

  assert.equal(rt.width, 32);
  assert.equal(rt.height, 16);
  assert.equal(rt.format, "rgba8unorm");
  assert.equal(rt.sampleCount, 1);
  assert.ok(rt.depth, "默认应带深度附件");

  const color = rt.colorAttachment();
  assert.equal(color.sampleCount, 1);
  assert.equal(color.resolveTo, null, "非 MSAA 不应有解析目标");
  assert.equal(color.loadOp, "clear");
  assert.equal(color.view, rt.texture.view());

  const depth = rt.depthAttachment();
  assert.ok(depth);
  assert.equal(depth!.sampleCount, 1);

  assert.equal(rt.texture.width, 32);
  assert.equal(rt.texture.height, 16);
  assert.ok((rt.texture.usage & TextureUsage.RENDER_ATTACHMENT) !== 0);
  assert.ok((rt.texture.usage & TextureUsage.TEXTURE_BINDING) !== 0, "默认可采样（后处理要读它）");

  assert.equal(rt.resize(32, 16), false, "尺寸没变不应重建");
  const before = rt.texture;
  assert.equal(rt.resize(64, 40), true);
  assert.equal(rt.width, 64);
  assert.notEqual(rt.texture, before, "resize 应重建纹理");
});

test("RenderTarget：无深度 / 不可采样 / MSAA 自动降级", () => {
  const device = createMockDevice();
  const noDepth = new RenderTarget(device, { width: 8, height: 8, depth: false, sampleable: false });
  assert.equal(noDepth.depth, null);
  assert.equal(noDepth.depthAttachment(), null);
  assert.equal(noDepth.texture.usage & TextureUsage.TEXTURE_BINDING, 0, "sampleable:false 不应带采样用途");

  // Mock 的 maxSamples = 4：请求 8 应降级到 4
  const msaa = new RenderTarget(device, { width: 16, height: 16, sampleCount: 8 });
  assert.equal(msaa.sampleCount, 4);
  const att = msaa.colorAttachment();
  assert.equal(att.sampleCount, 4);
  assert.ok(att.resolveTo, "MSAA 必须给出解析目标");
  assert.equal(att.resolveTo, msaa.texture.view(), "解析目标是那张可采样纹理");
  assert.notEqual(att.view, att.resolveTo, "渲染视图是多采样纹理，不是解析目标");
  assert.equal(msaa.depthAttachment()?.sampleCount, 4);

  msaa.dispose();
  noDepth.dispose();
});

test("EffectComposer：效果链按顺序 ping-pong，最后呈现到画布", () => {
  const device: MockDevice = createMockDevice();
  const composer = new EffectComposer(device, { width: 64, height: 48 });
  const a = new StubEffect("a");
  const b = new StubEffect("b");
  composer.addPass(a).addPass(b);

  let scenePassLabel = "";
  composer.render((pass) => {
    scenePassLabel = pass.label ?? "";
  });

  assert.equal(composer.passList.length, 2);
  assert.equal(a.calls.length, 1);
  assert.equal(b.calls.length, 1);
  assert.match(scenePassLabel, /composer-scene/);
  // 第一步读场景目标；第二步读第一步的输出（ping-pong）
  assert.equal(a.calls[0]!.inputs[0], composer.sceneTarget.texture);
  assert.notEqual(b.calls[0]!.inputs[0], composer.sceneTarget.texture);
  assert.equal(b.calls[0]!.inputs[0], a.calls[0]!.targetTexture);
  assert.notEqual(b.calls[0]!.targetTexture, a.calls[0]!.targetTexture, "两步不能写同一张目标");
  // 效果始终写内部目标（链路格式），再加一趟呈现 pass
  assert.ok(a.calls[0]!.targetTexture && b.calls[0]!.targetTexture);
  assert.equal(a.calls[0]!.format, "rgba8unorm");
  assert.equal(a.calls[0]!.targetFormat, "rgba8unorm");
  assert.equal(a.calls[0]!.label, "composer-a");
  assert.equal(b.calls[0]!.label, "composer-b");
  // pass 数 = 场景 + 2 个效果 + 呈现
  assert.equal(device.passCount, 4);

  // 第二帧语义不变（每帧从场景重新开始，避免反馈回读）
  composer.render(noopScene);
  assert.equal(a.calls[1]!.inputs[0], composer.sceneTarget.texture);
  assert.equal(b.calls[1]!.inputs[0], a.calls[1]!.targetTexture);
  assert.equal(device.passCount, 8);

  composer.dispose();
  assert.ok(a.disposed && b.disposed, "dispose 应释放效果");
  assert.equal(composer.passList.length, 0);
});

test("EffectComposer：无效果时直接拷贝场景到画布", () => {
  const device = createMockDevice();
  const composer = new EffectComposer(device, { width: 32, height: 32, format: "rgba8unorm" });
  let sceneCalls = 0;
  composer.render(() => {
    sceneCalls++;
  });
  assert.equal(sceneCalls, 1);
  assert.equal(composer.passList.length, 0);
  assert.equal(device.passCount, 2, "场景 + 拷贝呈现");
  assert.equal(composer.outputFormat, "rgba8unorm");
  composer.dispose();
});

test("EffectComposer：链路格式与画布格式不同也能呈现（拷贝 pass 按输出格式创建）", () => {
  const device = createMockDevice();
  // 链路用 rgba16float（HDR），画布是 rgba8unorm：效果管线都是 float 格式，
  // 只有最后的「呈现」pass 用画布格式 —— Mock 在 setPipeline 时会校验格式一致性
  const composer = new EffectComposer(device, { width: 16, height: 16, format: "rgba16float" });
  const effect = new StubEffect("fx");
  composer.addPass(effect);
  composer.render(noopScene);

  assert.equal(effect.calls[0]!.format, "rgba16float");
  assert.equal(effect.calls[0]!.targetFormat, "rgba16float");
  assert.equal(device.passCount, 3, "场景 + 效果 + 呈现");
  composer.dispose();
});

test("EffectComposer：显式输出目标（RenderTarget）时效果仍写内部目标，最后呈现到它", () => {
  const device = createMockDevice();
  const composer = new EffectComposer(device, { width: 20, height: 10, format: "rgba16float" });
  const effect = new StubEffect("fx");
  composer.addPass(effect);
  const out = new RenderTarget(device, { width: 20, height: 10, format: "rgba8unorm", depth: false, label: "out" });

  composer.render(noopScene, out);
  assert.equal(effect.calls[0]!.targetFormat, "rgba16float", "效果写链路格式的内部目标");
  assert.equal(device.passCount, 3);
  composer.dispose();
  out.dispose();
});

test("EffectComposer：renderToPixels 回读内部目标（Mock 清屏色可见）", async () => {
  const device = createMockDevice();
  const composer = new EffectComposer(device, { width: 4, height: 4 });
  const pixels = await composer.renderToPixels(noopScene);
  assert.equal(pixels.length, 4 * 4 * 4);
  // 场景 pass 默认清屏为不透明黑 → 拷到内部输出目标后内容一致
  assert.deepEqual(Array.from(pixels.slice(0, 4)), [0, 0, 0, 255]);
  composer.dispose();
});

test("EffectComposer：resize 传播到场景目标/内部目标/效果；setSampleCount 只换场景目标", () => {
  const device = createMockDevice();
  const composer = new EffectComposer(device, { width: 10, height: 10 });
  const effect = new StubEffect("fx");
  composer.addPass(effect);
  assert.deepEqual(effect.resizes, [[10, 10]], "addPass 时应初始化尺寸");

  assert.equal(composer.resize(10, 10), false);
  assert.equal(composer.resize(50, 25), true);
  assert.equal(composer.width, 50);
  assert.equal(composer.height, 25);
  assert.equal(composer.sceneTarget.width, 50);
  assert.deepEqual(effect.resizes.at(-1), [50, 25]);

  const before = composer.sceneTarget;
  assert.equal(composer.setSampleCount(1), false, "采样数没变不应重建");
  assert.equal(composer.setSampleCount(4), true);
  assert.notEqual(composer.sceneTarget, before);
  assert.equal(composer.sceneTarget.sampleCount, 4);
  assert.equal(composer.sceneTarget.width, 50, "重建后保持尺寸");
  assert.ok(composer.sceneTarget.depth, "重建后保持深度附件");
  assert.equal(composer.setSampleCount(99), false, "超上限会 clamp 到 4，与当前一致即不变");

  composer.dispose();
});

test("内置效果：CopyPass / GrayscalePass / ToneMapPass 可单独绘制到 RenderTarget", () => {
  const device = createMockDevice();
  const target = new RenderTarget(device, { width: 8, height: 8, depth: false });
  const copy = new CopyPass(device);
  const gray = new GrayscalePass(device, { amount: 0.5 });
  const tone = new ToneMapPass(device, { mode: "aces", exposure: 1.2 });

  for (const fx of [copy, gray, tone]) {
    const encoder = device.createCommandEncoder("fx");
    const pass = encoder.beginRenderPass({
      label: fx.name,
      colorAttachments: [target.colorAttachment()],
      depthStencilAttachment: null,
    });
    fx.draw(pass, target.texture, 8, 8);
    pass.end();
    device.submit([encoder.finish()]);
  }
  assert.equal(device.passCount, 3);
  copy.dispose();
  gray.dispose();
  tone.dispose();
  target.dispose();
});
