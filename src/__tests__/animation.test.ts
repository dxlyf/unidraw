/**
 * 动画模块单元测试：关键帧求值、缓动、Clip/Mixer/Action 播放语义、Tween。
 *
 * 全部为纯 CPU 逻辑（不需要 GPU），因此与后端无关。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Vec3 } from "../math/vec3.js";
import { Color } from "../math/color.js";
import { Mat4 } from "../math/mat4.js";
import { Easing, resolveEasing } from "../animation/easing.js";
import { KeyframeTrack } from "../animation/KeyframeTrack.js";
import { NumberTrackType, numberTrack } from "../animation/NumberTrack.js";
import { vec3Track, vec3Keys } from "../animation/Vec3Track.js";
import { colorTrack, colorKeys } from "../animation/ColorTrack.js";
import { AnimationClip } from "../animation/AnimationClip.js";
import { AnimationAction } from "../animation/AnimationAction.js";
import { AnimationMixer } from "../animation/AnimationMixer.js";
import { tweenNumber, tweenVec3, tweenColor } from "../animation/Tween.js";
import { tweenObject } from "../animation/tweenObject.js";
import { TweenManager } from "../animation/TweenManager.js";
import { propertyTrack, nodePositionTrack } from "../animation/bindings.js";
import { Mesh } from "../render/Mesh.js";
import { createMockDevice } from "../device/createDevice.js";
import { Geometry } from "../render/Geometry.js";
import { box } from "../render/primitives.js";
import { ColorMaterial } from "../render/material.js";

test("KeyframeTrack：线性插值、首末帧钳制与 step 插值", () => {
  let value = 0;
  const track = numberTrack((v) => (value = v), [
    { time: 0, value: 0 },
    { time: 1, value: 10 },
    { time: 2, value: 0, interpolation: "step" },
    { time: 3, value: 5 },
  ]);
  assert.equal(track.duration, 3);

  track.apply(-1);
  assert.equal(value, 0, "早于首帧取首值");
  track.apply(0.5);
  assert.equal(value, 5, "线性插值中点");
  track.apply(1.5);
  assert.equal(value, 5, "step 段保持左值");
  track.apply(2.5);
  assert.equal(value, 0, "step 段末仍未生效");
  track.apply(99);
  assert.equal(value, 5, "晚于末帧取末值");
});

test("KeyframeTrack：easing、倒序关键帧与顺序游标缓存", () => {
  let value = 0;
  // 关键帧故意乱序，构造时应排序；easing 属于「本段左端关键帧」
  const track = numberTrack((v) => (value = v), [
    { time: 1, value: 10 },
    { time: 0, value: 0, easing: "quadIn" },
  ]);
  track.apply(0.5);
  assert.ok(Math.abs(value - 2.5) < 1e-9, `quadIn(0.5)=0.25 → 2.5，实际 ${value}`);
  // 右端关键帧的 easing 不影响左段（段缓动只取左端）
  const track2 = numberTrack((v) => (value = v), [
    { time: 0, value: 0 },
    { time: 1, value: 10, easing: "quadIn" },
  ]);
  track2.apply(0.5);
  assert.ok(Math.abs(value - 5) < 1e-9, `段缓动取左端 → 线性 5，实际 ${value}`);
  // 反复前后跳转仍正确（游标缓存 + 回退）
  for (const t of [0.2, 0.9, 0.1, 0.7, 0.3]) track.apply(t);
  assert.ok(value >= 0 && value <= 10);
});

test("KeyframeTrack：Vec3 轨道复用暂存值，不产生垃圾", () => {
  const out = new Vec3();
  const track = vec3Track(
    (v) => out.copy(v),
    vec3Keys([
      { time: 0, value: [0, 0, 0] },
      { time: 2, value: [4, 8, 12] },
    ]),
  );
  track.apply(1);
  assert.ok(Math.abs(out.x - 2) < 1e-6 && Math.abs(out.y - 4) < 1e-6 && Math.abs(out.z - 6) < 1e-6);
  // 采样不写回
  const sampled = new Vec3();
  track.sample(0.5, sampled);
  assert.ok(Math.abs(sampled.x - 1) < 1e-6);
  assert.ok(Math.abs(out.x - 2) < 1e-6, "sample 不应改变写回目标");
});

test("KeyframeTrack：weight < 1 时与上次写回值混合（淡入淡出）", () => {
  let value = -1;
  const track = numberTrack((v) => (value = v), [
    { time: 0, value: 0 },
    { time: 1, value: 100 },
  ]);
  track.apply(0, 1); // 先写 0
  track.apply(1, 0.5); // 目标 100，权重 0.5 → 与上次(0)混合 = 50
  assert.ok(Math.abs(value - 50) < 1e-9, `期望 50，实际 ${value}`);
  track.apply(1, 1);
  assert.equal(value, 100);
});

test("缓动：名称解析与端点值", () => {
  assert.equal(resolveEasing()(0.42), 0.42);
  assert.equal(resolveEasing("linear")(0.42), 0.42);
  assert.equal(Easing.cubicIn(0), 0);
  assert.equal(Easing.cubicIn(1), 1);
  assert.equal(Easing.step(0.99), 0);
  assert.equal(Easing.step(1), 1);
  assert.ok(Easing.backOut(0.5) > 0.5, "backOut 中段应超前");
  assert.ok(Easing.smooth(0.5) - 0.5 < 1e-12, "smoothstep 中点为 0.5");
});

test("AnimationMixer：循环播放、循环次数与完成回调", () => {
  let value = 0;
  const track = numberTrack((v) => (value = v), [
    { time: 0, value: 0 },
    { time: 1, value: 10 },
  ]);
  const clip = new AnimationClip("test", {}).addTrack(track);
  assert.equal(clip.effectiveDuration, 1);

  const mixer = new AnimationMixer();
  const action = mixer.clip(clip, { loop: "repeat" });
  action.play();
  mixer.update(0.5);
  assert.ok(Math.abs(value - 5) < 1e-9, `0.5s 时应为 5，实际 ${value}`);
  mixer.update(0.75); // 1.25s → 已进入第二轮
  assert.equal(action.loopCount, 1);
  assert.ok(Math.abs(action.time - 0.25) < 1e-9, `第二轮 0.25s，实际 ${action.time}`);
  assert.ok(Math.abs(value - 2.5) < 1e-9);

  // timeScale 影响所有动作
  mixer.timeScale = 2;
  mixer.update(0.25); // = 0.5s
  assert.ok(Math.abs(action.time - 0.75) < 1e-9, `实际 ${action.time}`);
  mixer.timeScale = 1;

  // 暂停不推进
  action.pause();
  mixer.update(1);
  assert.ok(Math.abs(action.time - 0.75) < 1e-9);
  action.resume();
});

test("AnimationMixer：once 模式停在末帧并触发 onFinished", () => {
  let value = 0;
  const clip = new AnimationClip("once").addTrack(numberTrack((v) => (value = v), [
    { time: 0, value: 0 },
    { time: 1, value: 7 },
  ]));
  const mixer = new AnimationMixer();
  let finished = 0;
  const action = mixer.clip(clip, { loop: "once", clampWhenFinished: true }).onFinished(() => finished++);
  action.play();
  mixer.update(2);
  assert.equal(action.running, false);
  assert.equal(action.finished, true);
  assert.equal(finished, 1);
  assert.equal(value, 7, "clampWhenFinished 应停在末帧值");

  // 有限次循环：repetitions=2 后停止
  const action2 = mixer.clip(new AnimationClip("r2").addTrack(numberTrack(() => {}, [
    { time: 0, value: 0 },
    { time: 1, value: 1 },
  ])), { loop: "repeat", repetitions: 2 });
  action2.play();
  mixer.update(1.5);
  assert.equal(action2.running, true, "两次循环内应仍在运行");
  mixer.update(1.0);
  assert.equal(action2.running, false, "超过 repetitions 后停止");
});

test("AnimationMixer：ping-pong 往复与负时间缩放倒放", () => {
  const clip = new AnimationClip("pp").addTrack(numberTrack(() => {}, [
    { time: 0, value: 0 },
    { time: 1, value: 1 },
  ]));
  const mixer = new AnimationMixer();
  const action = mixer.clip(clip, { loop: "ping-pong" });
  action.play();
  mixer.update(1.5);
  assert.equal(action.direction, -1, "过半后应反向");
  assert.ok(Math.abs(action.time - 0.5) < 1e-9, `反弹到 0.5，实际 ${action.time}`);

  const back = mixer.clip(new AnimationClip("back").addTrack(numberTrack(() => {}, [
    { time: 0, value: 0 },
    { time: 1, value: 1 },
  ])), { loop: "repeat" });
  back.time = 1;
  back.timeScale = -1;
  back.play();
  mixer.update(0.25);
  assert.ok(Math.abs(back.time - 0.75) < 1e-9, `倒放 0.25s → 0.75，实际 ${back.time}`);
});

test("AnimationMixer：淡入淡出改变有效权重，stopAll 复位", () => {
  const clip = new AnimationClip("fade").addTrack(numberTrack(() => {}, [
    { time: 0, value: 0 },
    { time: 1, value: 1 },
  ]));
  const mixer = new AnimationMixer();
  const action = mixer.clip(clip, { weight: 1 });
  action.play().fadeIn(0.4);
  assert.equal(action.effectiveWeight, 0);
  mixer.update(0.2);
  assert.ok(Math.abs(action.effectiveWeight - 0.5) < 1e-6, `实际 ${action.effectiveWeight}`);
  mixer.update(0.2);
  assert.ok(Math.abs(action.effectiveWeight - 1) < 1e-6);
  assert.equal(mixer.running, true);
  mixer.stopAll();
  assert.equal(mixer.running, false);
  assert.equal(action.time, 0);
});

test("Tween：数值补间 + 延迟 + 重复 + 往返", () => {
  const values: number[] = [];
  const tween = tweenNumber(0, 10, 1, (v) => values.push(v), { easing: "linear", delay: 0.5, repeat: 1, yoyo: true });
  tween.play();
  assert.equal(tween.update(0.25), true, "延迟期间仍在运行");
  assert.equal(values.length, 0, "延迟期间不应写值");
  tween.update(0.5); // 剩余延迟 0.25 → 实际前进 0.25 → 2.5
  assert.ok(Math.abs(tween.value - 2.5) < 1e-9, `实际 ${tween.value}`);
  tween.update(0.75); // 到达终点 1.0s → 值 10，并翻转为反向
  assert.ok(Math.abs(tween.value - 10) < 1e-9, `到达终点应为 10，实际 ${tween.value}`);
  assert.equal(tween.loop, 1, "已开始第 2 轮（yoyo 反向）");
  tween.update(0.25); // 反向走了 0.25 → 7.5
  assert.ok(Math.abs(tween.value - 7.5) < 1e-9, `反向 0.25 后应为 7.5，实际 ${tween.value}`);
  tween.update(1.0); // 反向走完（含 0.25 溢出）→ 回到 0 并结束
  assert.equal(tween.finished, true);
  assert.ok(Math.abs(tween.value) < 1e-9, `yoyo 结束应回到起点，实际 ${tween.value}`);
});

test("Tween：Vec3/Color/对象属性补间", () => {
  const p = new Vec3();
  const vt = tweenVec3(new Vec3(0, 0, 0), new Vec3(2, 4, 6), 1, (v) => p.copy(v), { easing: "linear" });
  vt.play();
  vt.update(0.5);
  assert.ok(Math.abs(p.x - 1) < 1e-6 && Math.abs(p.z - 3) < 1e-6);

  const c = new Color(0, 0, 0, 1);
  const ct = tweenColor(new Color(0, 0, 0, 1), new Color(1, 0.5, 0.25, 1), 1, (v) => c.copy(v), { easing: "linear" });
  ct.play();
  ct.update(0.5);
  assert.ok(Math.abs(c.r - 0.5) < 1e-6 && Math.abs(c.g - 0.25) < 1e-6);

  const target = { x: 0, y: 5, label: "keep" };
  const ot = tweenObject(target, { x: 10, y: -5 }, 1, { easing: "linear" });
  ot.play();
  ot.update(0.5);
  assert.ok(Math.abs(target.x - 5) < 1e-9 && Math.abs(target.y) < 1e-9);
  assert.equal(target.label, "keep", "非数值属性不受影响");
});

test("TweenManager：自动移除完成的 Tween", () => {
  const manager = new TweenManager();
  let done = 0;
  manager.add(tweenNumber(0, 1, 0.5, () => {}, { onComplete: () => done++ }));
  manager.add(tweenNumber(0, 1, 5, () => {}));
  assert.equal(manager.count, 2);
  manager.update(1);
  assert.equal(done, 1);
  assert.equal(manager.count, 1, "完成的 Tween 自动移除");
  manager.stopAll();
  assert.equal(manager.count, 0);
});

test("自定义绑定：驱动 Node3D（含脏标记）与材质颜色", () => {
  const device = createMockDevice();
  const mesh = new Mesh(Geometry.create(device, box(1, 1, 1)));
  const material = new ColorMaterial(device, new Color(1, 1, 1, 1));

  const track = propertyTrack(mesh.scale, "x", [
    { time: 0, value: 1 },
    { time: 1, value: 3 },
  ]);
  track.apply(0.5);
  assert.ok(Math.abs(mesh.scale.x - 2) < 1e-6);

  const posTrack = nodePositionTrack(mesh, vec3Keys([
    { time: 0, value: [0, 0, 0] },
    { time: 1, value: [2, 0, 0] },
  ]));
  posTrack.apply(1);
  mesh.updateWorldMatrix(true);
  assert.ok(Math.abs(mesh.worldMatrix.elements[12]! - 2) < 1e-6, "世界矩阵应跟随位移");

  const colorT = colorTrack((c) => material.setColor(c), colorKeys([
    { time: 0, value: "#000000" },
    { time: 1, value: "#ffffff" },
  ]));
  colorT.apply(0.5);
  assert.ok(Math.abs(material.color.r - 0.5) < 1e-5, `实际 ${material.color.r}`);

  // 自定义对象（非 Node3D/材质）也能被驱动
  const custom = { value: 0, applied: 0 };
  const customTrack = new KeyframeTrack<number>({
    keys: [
      { time: 0, value: 0 },
      { time: 1, value: 4 },
    ],
    type: NumberTrackType,
    write: (v) => {
      custom.value = v;
      custom.applied++;
    },
  });
  customTrack.apply(0.25);
  assert.equal(custom.value, 1);
  assert.equal(custom.applied, 1);
  device.destroy();
});

test("AnimationAction：seek/restart/progress 与时长推导", () => {
  const clip = new AnimationClip("seek", { duration: 5 }).addTrack(numberTrack(() => {}, [
    { time: 0, value: 0 },
    { time: 1, value: 1 },
  ]));
  const action = new AnimationAction(clip, { loop: "once" });
  assert.equal(action.duration, 5, "显式时长优先");
  action.seek(2.5);
  assert.ok(Math.abs(action.progress - 0.5) < 1e-9);
  action.play();
  assert.equal(action.running, true);
  action.restart();
  assert.equal(action.time, 0);
  // Mat4 仅用于确认本测试不依赖渲染（保持与其它测试一致的导入使用）
  assert.equal(Mat4.identity().elements[0], 1);
});
