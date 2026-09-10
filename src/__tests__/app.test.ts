/**
 * App / Plugin 单元测试（Mock 后端 + 假 canvas，无需浏览器）。
 *
 * 覆盖：插件生命周期顺序、异步 setup、手动步进 `step()`、stats、尺寸变化通知、
 * 动画（Mixer/Tween）集成、销毁顺序与资源释放。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockDevice } from "../device/createDevice.js";
import { App } from "../app/App.js";
import { Camera } from "../render/Camera.js";
import { Renderer } from "../render/Renderer.js";
import { definePlugin, type Plugin } from "../app/Plugin.js";
import { Mesh } from "../render/Mesh.js";
import { Geometry } from "../render/Geometry.js";
import { box } from "../render/primitives.js";
import { ColorMaterial } from "../render/material.js";
import { Color } from "../math/color.js";
import { AnimationClip } from "../animation/AnimationClip.js";
import { nodePositionTrack, vec3Keys } from "../animation/index.js";
import { tweenNumber } from "../animation/Tween.js";
import type { MaterialLike } from "../scene/types.js";

function fakeCanvas(width = 256, height = 128): HTMLCanvasElement {
  return {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    style: {},
    addEventListener() {},
    removeEventListener() {},
    setPointerCapture() {},
    releasePointerCapture() {},
  } as unknown as HTMLCanvasElement;
}

test("App：插件生命周期顺序 + 手动步进 + stats", async () => {
  const device = createMockDevice();
  const canvas = fakeCanvas();
  const app = App.fromDevice(device, canvas, {
    depth: false,
    input: false,
    autoResize: false,
    background: "#101418",
  });

  const log: string[] = [];
  const plugin = definePlugin({
    name: "probe",
    setup: () => {
      log.push("setup");
    },
    update: (_ctx, dt) => log.push(`update:${dt.toFixed(4)}`),
    beforeRender: () => log.push("before"),
    afterRender: () => log.push("after"),
    resize: (_ctx, w, h) => log.push(`resize:${w}x${h}`),
    dispose: () => log.push("dispose"),
  });
  await app.useAsync(plugin);

  const mesh = new Mesh(Geometry.create(device, box(1, 1, 1)));
  mesh.material = new ColorMaterial(device, new Color(1, 1, 1, 1), { depth: false, targetFormat: "rgba8unorm" });
  app.scene.add(mesh);
  app.onRender(() => log.push("onRender"));

  app.step(1 / 60);

  assert.deepEqual(log.slice(0, 5), ["setup", "update:0.0167", "before", "onRender", "after"]);
  assert.equal(app.stats.frames, 1);
  assert.ok(Math.abs(app.stats.dt - 1 / 60) < 1e-9);
  assert.ok(Math.abs(app.stats.time - 1 / 60) < 1e-9);
  assert.equal(app.stats.objects, 1, `objects 应为 1（实际 ${app.stats.objects}，drawn=${app.stats.drawn}, culled=${app.stats.culled}）`);
  assert.equal(app.stats.drawn, 1, `drawn 应为 1（实际 drawn=${app.stats.drawn}, objects=${app.stats.objects}, culled=${app.stats.culled}）`);

  // dt 会被 clamp 到 0.25s（避免切页大跳变）
  app.step(10);
  assert.ok(Math.abs(app.stats.dt - 0.25) < 1e-9, `dt 应被 clamp，实际 ${app.stats.dt}`);

  // 手动 resize → resize 钩子 + stats 更新 + 相机纵横比
  app.resize(320, 240);
  assert.ok(log.includes("resize:320x240"));
  assert.equal(app.stats.width, 320);
  assert.ok(Math.abs(app.camera.aspect - 320 / 240) < 1e-6);

  app.dispose();
  assert.equal(log[log.length - 1], "dispose");
  assert.equal(app.plugins.length, 0);
  assert.equal(app.running, false);
});

test("App：插件逆序销毁；onRender 取消订阅生效", async () => {
  const device = createMockDevice();
  const app = App.fromDevice(device, fakeCanvas(), { depth: false, input: false, autoResize: false });
  const order: string[] = [];
  await app.useAsync(definePlugin({ name: "a", dispose: () => order.push("a") }));
  await app.useAsync(definePlugin({ name: "b", dispose: () => order.push("b") }));

  let calls = 0;
  const off = app.onRender(() => calls++);
  app.step(1 / 60);
  off();
  app.step(1 / 60);
  assert.equal(calls, 1, "取消订阅后不应再回调");

  app.dispose();
  assert.deepEqual(order, ["b", "a"], "插件应按注册逆序销毁");
});

test("App：Mixer 与 Tween 随 step 推进，并驱动场景对象", async () => {
  const device = createMockDevice();
  const app = App.fromDevice(device, fakeCanvas(), { depth: false, input: false, autoResize: false });

  const mesh = new Mesh(Geometry.create(device, box(1, 1, 1)));
  mesh.material = new ColorMaterial(device, new Color(1, 1, 1, 1), { depth: false, targetFormat: "rgba8unorm" });
  app.scene.add(mesh);

  const clip = new AnimationClip("move", { duration: 1 }).addTrack(
    nodePositionTrack(
      mesh,
      vec3Keys([
        { time: 0, value: [0, 0, 0] },
        { time: 1, value: [2, 0, 0] },
      ]),
    ),
  );
  const action = app.mixer.play(clip, { loop: "once" });

  let tweenValue = -1;
  app.tweens.add(tweenNumber(0, 10, 1, (v) => (tweenValue = v), { easing: "linear" }));

  // step 的 dt 会被 clamp 到 0.25s，因此分两步推进 0.5s
  app.step(0.25);
  app.step(0.25);
  assert.ok(Math.abs(mesh.position.x - 1) < 1e-6, `Mixer 应把位置推进到 1，实际 ${mesh.position.x}`);
  assert.ok(Math.abs(tweenValue - 5) < 1e-6, `Tween 应推进到 5，实际 ${tweenValue}`);
  assert.ok(action.running);

  app.step(0.25);
  app.step(0.25);
  app.step(0.25);
  assert.equal(action.running, false, "once 片段应结束");
  assert.ok(Math.abs(mesh.position.x - 2) < 1e-6);
  assert.equal(app.tweens.count, 0, "Tween 完成后自动移除");

  app.dispose();
});

test("App：renderScene=false 时交由 onRender 接管；raycast 可用", async () => {
  const device = createMockDevice();
  const app = App.fromDevice(device, fakeCanvas(), {
    depth: false,
    input: false,
    autoResize: false,
    renderScene: false,
  });
  const mesh = new Mesh(Geometry.create(device, box(1, 1, 1)));
  mesh.material = new ColorMaterial(device, new Color(1, 1, 1, 1), { depth: false, targetFormat: "rgba8unorm" });
  app.scene.add(mesh);
  app.camera.distance = 4;
  app.camera.center.set(0, 0, 0);
  app.camera.update();

  let drew = false;
  app.onRender((pass) => {
    drew = true;
    mesh.material!.drawGeometry(pass, mesh.geometry, mesh.worldMatrix);
  });
  app.step(1 / 60);
  assert.equal(drew, true);
  assert.equal(app.stats.drawn, 0, "renderScene=false 时 App 不统计/不绘制场景");

  const hit = app.raycast({ x: 0, y: 0 });
  assert.ok(hit, "正前方应命中立方体");
  assert.equal(hit!.object, mesh);
  assert.equal(app.raycast({ x: 0.99, y: 0.99 }), null);

  app.dispose();
});

test("SceneRenderer.render：绘制前自动把相机喂给每个材质（否则画面全空）", () => {
  const device = createMockDevice();
  const app = App.fromDevice(device, fakeCanvas(), { depth: false, input: false, autoResize: false, renderScene: false });
  app.camera.center.set(0, 0, 0);
  app.camera.distance = 6;
  app.camera.update();

  let beginFrameCalls = 0;
  let drawCalls = 0;
  let seenViewProjection: Float32Array | null = null;
  const material: MaterialLike = {
    beginFrame(viewProjection) {
      beginFrameCalls++;
      seenViewProjection = viewProjection.elements;
    },
    drawGeometry() {
      drawCalls++;
    },
  };
  // 两个 Mesh 共用一个材质实例 + 一个独立材质 → beginFrame 应只调用 2 次
  const shared = new Mesh(Geometry.create(device, box(1, 1, 1)));
  shared.material = material;
  const shared2 = new Mesh(Geometry.create(device, box(1, 1, 1)));
  shared2.material = material;
  shared2.setPosition(2, 0, 0);
  const other: MaterialLike = { drawGeometry: () => drawCalls++ };
  const single = new Mesh(Geometry.create(device, box(1, 1, 1)));
  single.material = other;
  single.setPosition(-2, 0, 0);
  app.scene.add(shared, shared2, single);

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({ colorAttachments: [], depthStencilAttachment: null });
  app.sceneRenderer.render(pass, app.scene, app.camera);
  pass.end();

  assert.equal(drawCalls, 3, "三个 Mesh 都应绘制");
  assert.equal(beginFrameCalls, 1, "共享材质实例只喂一次相机");
  assert.ok(seenViewProjection, "应收到相机矩阵");
  const vp = app.camera.viewProjection.elements;
  for (let i = 0; i < 16; i++) {
    assert.equal(seenViewProjection![i], vp[i], `viewProjection[${i}] 应传给材质`);
  }
  // 没有 beginFrame 的材质也应正常工作（接口可选）
  assert.equal(app.sceneRenderer.stats.drawn, 3);
  app.dispose();
});

test("Camera.pitch 约定：正值 = 相机在目标上方（负值会钻到地板下面）", () => {
  const cam = new Camera();
  cam.center.set(0, 0.7, 0);
  cam.distance = 8;
  cam.pitch = 0.3;
  cam.update();
  const above = cam.eyePosition;
  assert.ok(above.y > cam.center.y, `pitch>0 时相机应在目标上方，实际 eye.y=${above.y}`);
  assert.ok(above.y > 2.5, `eye.y 应明显高于 center，实际 ${above.y}`);

  cam.pitch = -0.3;
  cam.update();
  const below = cam.eyePosition;
  assert.ok(below.y < cam.center.y, `pitch<0 时相机应在目标下方（这是「钻到地板下面」的常见误用）`);

  // lookAt 反解出的 pitch 也遵循同一约定：眼睛在上方 → pitch 为正
  const cam2 = new Camera();
  cam2.lookAt(0, 10, 0, 0, 0, 0);
  assert.ok(cam2.pitch > 0, `lookAt 从上方看时 pitch 应为正，实际 ${cam2.pitch}`);
  cam2.update();
  const eye = cam2.eyePosition;
  assert.ok(Math.abs(eye.x) < 1e-6 && Math.abs(eye.y - 10) < 1e-6 && Math.abs(eye.z) < 1e-6, `eye 应回到 (0,10,0)，实际 ${eye.y}`);
});

test("Renderer.resizeToDisplaySize：无 CSS 尺寸时不会每帧翻倍（反馈回路防护）", () => {
  const device = createMockDevice();
  const canvas = {
    width: 480,
    height: 300,
    clientWidth: 480,
    clientHeight: 300,
    style: {},
  } as unknown as HTMLCanvasElement & { clientWidth: number; clientHeight: number };
  const renderer = Renderer.fromDevice(device, canvas, {});
  const g = globalThis as { devicePixelRatio?: number };
  const prev = g.devicePixelRatio;
  g.devicePixelRatio = 2;
  try {
    // CSS 尺寸 == drawingBuffer 尺寸 → 说明没有 CSS 尺寸：跳过放大（否则每帧 ×2）
    assert.equal(renderer.resizeToDisplaySize(), false);
    assert.equal(canvas.width, 480);
    assert.equal(canvas.height, 300);

    // 有独立 CSS 尺寸 → 正常按 dpr 放大，且只放大一次
    canvas.clientWidth = 520;
    canvas.clientHeight = 264;
    assert.equal(renderer.resizeToDisplaySize(), true);
    assert.equal(canvas.width, 1040);
    assert.equal(canvas.height, 528);
    assert.equal(renderer.resizeToDisplaySize(), false, "尺寸已匹配时不应重复设置");
  } finally {
    if (prev === undefined) delete g.devicePixelRatio;
    else g.devicePixelRatio = prev;
    device.destroy();
  }
});

test("App：插件异步 setup 被等待（useAsync），use 返回可链式", async () => {
  const device = createMockDevice();
  const app = App.fromDevice(device, fakeCanvas(), { depth: false, input: false, autoResize: false });
  let ready = false;
  const p: Plugin = {
    name: "async",
    async setup() {
      await Promise.resolve();
      ready = true;
    },
  };
  await app.useAsync(p);
  assert.equal(ready, true);
  assert.equal(app.plugins.length, 1);
  app.use(definePlugin({ name: "sync" }));
  assert.equal(app.plugins.length, 2);
  app.dispose();
});
