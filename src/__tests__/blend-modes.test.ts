/**
 * 图层混合模式（以目标为纹理的那 11 种）单元测试。
 *
 * 着色器本身跑不了 CPU 断言（数值一致性靠 `examples/_verify-2d-parity` 的逐像素对照），
 * 这里守住的是**接线**：模式表、`globalCompositeOperation` 不再回退、以及「只有用到
 * 这些模式时才切图层模式」——切错了要么整帧画不出来，要么白白多两张全屏目标。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockDevice } from "../device/createDevice.js";
import { Canvas2D } from "../render2d/Canvas2D.js";
import { RenderTarget } from "../render/RenderTarget.js";
import { DST_TEXTURE_BLEND_MODES, dstTextureBlendIndex } from "../render2d/blendPass.js";
import { blendForComposite } from "../render2d/composite.js";
import { Mat4 } from "../math/mat4.js";

/** 画一帧：背景 + 可选的一个用 `comp` 合成的方块 */
function frame(comp: string | null): number {
  const device = createMockDevice();
  const c2d = new Canvas2D(device);
  const target = new RenderTarget(device, { width: 64, height: 64, depth: false });
  c2d.setViewportSize(64, 64);
  c2d.begin();
  c2d.fillStyle = "#335577";
  c2d.fillRect(0, 0, 64, 64);
  if (comp) {
    c2d.globalCompositeOperation = comp;
    c2d.fillStyle = "#ff8844";
    c2d.fillRect(8, 8, 40, 40);
  }
  const enc = device.createCommandEncoder("t");
  const pass = enc.beginRenderPass({
    label: "t",
    colorAttachments: [target.colorAttachment()],
    depthStencilAttachment: null,
  });
  c2d.flush(pass, Mat4.ortho(0, 64, 64, 0, -1, 1));
  pass.end();
  device.submit([enc.finish()]);
  return device.passCount;
}

test("混合模式表：11 种以目标为纹理的模式都有编号，其余返回 -1", () => {
  assert.equal(DST_TEXTURE_BLEND_MODES.length, 11);
  DST_TEXTURE_BLEND_MODES.forEach((name, i) => assert.equal(dstTextureBlendIndex(name), i, name));
  // 能用硬件混合表达的那些**不能**落进图层模式（否则白跑一张全屏合成）
  for (const name of ["source-over", "multiply", "screen", "darken", "lighten", "copy", "xor", "lighter"]) {
    assert.equal(dstTextureBlendIndex(name), -1, name);
    assert.ok(blendForComposite(name), `${name} 应由硬件混合表处理`);
  }
  assert.equal(dstTextureBlendIndex("not-a-mode"), -1);
});

test("Canvas2D：这 11 种模式不再回退 source-over", () => {
  const device = createMockDevice();
  const c2d = new Canvas2D(device);
  for (const name of DST_TEXTURE_BLEND_MODES) {
    c2d.globalCompositeOperation = name;
    assert.equal(c2d.globalCompositeOperation, name, name);
  }
  c2d.globalCompositeOperation = "没有这个模式";
  assert.equal(c2d.globalCompositeOperation, "source-over", "未知模式仍要回退");
});

test("Canvas2D：只有用到图层混合模式才多开图层 pass", () => {
  const plain = frame(null);
  const hardware = frame("multiply");
  assert.equal(hardware, plain, "硬件混合模式不应该改变 pass 数量");

  // 图层模式：源图层 + 混合 + 图层呈现 = 3 个额外 pass
  const layered = frame("overlay");
  assert.equal(layered, plain + 3);
});
