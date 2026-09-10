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
import { definePlugin, type Plugin } from "../app/Plugin.js";
import { Mesh } from "../render/Mesh.js";
import { Geometry } from "../render/Geometry.js";
import { box } from "../render/primitives.js";
import { ColorMaterial } from "../render/material.js";
import { Color } from "../math/color.js";
import { AnimationClip } from "../animation/AnimationClip.js";
import { nodePositionTrack, vec3Keys } from "../animation/index.js";
import { tweenNumber } from "../animation/Tween.js";

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
