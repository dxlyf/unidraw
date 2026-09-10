/**
 * 灯光系统单元测试：打包布局、上限、场景收集语义、默认光等价性、SceneRenderer 集成。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Color } from "../math/color.js";
import { Vec3 } from "../math/vec3.js";
import { Scene } from "../scene/Scene.js";
import { Node3D } from "../scene/Node3D.js";
import { SceneRenderer } from "../scene/SceneRenderer.js";
import { Mesh } from "../render/Mesh.js";
import { Geometry } from "../render/Geometry.js";
import { box } from "../render/primitives.js";
import { Camera } from "../render/Camera.js";
import { createMockDevice } from "../device/createDevice.js";
import {
  AmbientLight,
  DirectionalLight,
  MAX_DIRECTIONAL_LIGHTS,
  MAX_POINT_LIGHTS,
  MAX_SPOT_LIGHTS,
  PointLight,
  SpotLight,
  LightsState,
  collectLights,
} from "../render/lights/index.js";
import type { MaterialLike } from "../scene/types.js";

/** 从打包数据里按 std140 偏移取 vec4（与 LightsState 布局一致） */
function vec4(data: Float32Array, offsetFloats: number): number[] {
  return [data[offsetFloats]!, data[offsetFloats + 1]!, data[offsetFloats + 2]!, data[offsetFloats + 3]!];
}
/** Float32 存储有精度损失，用容差比较 */
function nearArray(actual: number[], expected: number[], tol = 1e-6, label = ""): void {
  assert.equal(actual.length, expected.length, `${label} 长度不一致`);
  for (let i = 0; i < expected.length; i++) {
    assert.ok(
      Math.abs(actual[i]! - expected[i]!) <= tol,
      `${label} 第 ${i} 项应为 ${expected[i]}，实际 ${actual[i]}`,
    );
  }
}
/** std140 偏移（float 数）：2 个 vec4 头 + dirDir/dirColor 各 4 + pointPos/Color 各 8 */
const OFF = {
  ambient: 0,
  counts: 4,
  dirDir: 8,
  dirColor: 8 + 4 * 4,
  pointPos: 8 + 8 * 4,
  pointColor: 8 + 8 * 4 + 8 * 4,
  spotPos: 8 + 8 * 4 + 8 * 4 + 8 * 4,
  spotDir: 8 + 8 * 4 + 8 * 4 + 8 * 4 + 4 * 4,
  spotColor: 8 + 8 * 4 + 8 * 4 + 8 * 4 + 4 * 4 + 4 * 4,
};

test("LightsState：环境光累加、方向光归一化、数量写入", () => {
  const state = new LightsState();
  state.reset();
  state.addAmbient(new Color(1, 1, 1, 1), 0.25); // 白 0.25
  state.addAmbient(new Color(0, 0.5, 1, 1), 0.4); // 再叠加 (0, 0.2, 0.4)
  const dir = state.addDirectional(new Vec3(0, -10, 0), new Color(1, 0.5, 0.25, 1), 2);
  assert.equal(dir, true);
  state.finish();

  nearArray(vec4(state.data, OFF.ambient).slice(0, 3), [0.25, 0.45, 0.65], 1e-6, "环境光累加");
  nearArray(vec4(state.data, OFF.counts).slice(0, 3), [1, 0, 0], 1e-6, "数量");
  // 方向被归一化（长度 10 → 单位向量）
  const packedDir = vec4(state.data, OFF.dirDir);
  assert.ok(Math.abs(packedDir[0]!) < 1e-6 && Math.abs(packedDir[1]! + 1) < 1e-6 && Math.abs(packedDir[2]!) < 1e-6);
  // 颜色 × 强度
  nearArray(vec4(state.data, OFF.dirColor).slice(0, 3), [2, 1, 0.5], 1e-6, "方向光颜色×强度");
});

test("LightsState：超过上限返回 false 并计数（方向 4 / 点 8 / 聚 4）", () => {
  const state = new LightsState().reset();
  const white = new Color(1, 1, 1, 1);
  const dir = new Vec3(0, -1, 0);
  for (let i = 0; i < MAX_DIRECTIONAL_LIGHTS; i++) assert.equal(state.addDirectional(dir, white, 1), true);
  assert.equal(state.addDirectional(dir, white, 1), false);
  for (let i = 0; i < MAX_POINT_LIGHTS; i++) assert.equal(state.addPoint(new Vec3(i, 0, 0), white, 1, 0, 2), true);
  assert.equal(state.addPoint(new Vec3(0, 0, 0), white, 1, 0, 2), false);
  for (let i = 0; i < MAX_SPOT_LIGHTS; i++) assert.equal(state.addSpot(new Vec3(), dir, white, 1), true);
  assert.equal(state.addSpot(new Vec3(), dir, white, 1), false);
  state.finish();
  assert.equal(state.overflow, 3);
  nearArray(vec4(state.data, OFF.counts).slice(0, 3), [MAX_DIRECTIONAL_LIGHTS, MAX_POINT_LIGHTS, MAX_SPOT_LIGHTS], 1e-6, "数量上限");
});

test("LightsState：聚光把锥角预计算成 cos（外锥=cos(angle)，内锥=cos(angle·(1-penumbra))）", () => {
  const state = new LightsState().reset();
  const angle = Math.PI / 6;
  state.addSpot(new Vec3(1, 2, 3), new Vec3(0, -1, 0), new Color(1, 1, 1, 1), 1, 9, angle, 0.5);
  state.finish();
  const spotPos = vec4(state.data, OFF.spotPos);
  nearArray(spotPos.slice(0, 3), [1, 2, 3], 1e-6, "聚光位置");
  assert.equal(spotPos[3], 9, "range 写入 spotPos.w");
  const spotDir = vec4(state.data, OFF.spotDir);
  assert.ok(Math.abs(spotDir[1]! + 1) < 1e-6);
  assert.ok(Math.abs(spotDir[3]! - Math.cos(angle)) < 1e-6, "w = cos(外锥角)");
  const spotColor = vec4(state.data, OFF.spotColor);
  assert.ok(Math.abs(spotColor[3]! - Math.cos(angle * 0.5)) < 1e-6, "a = cos(内锥角)");
});

test("默认光与历史 shader 常量等价（0.35 环境 + 0.65·方向光）", () => {
  const state = new LightsState().fillDefault();
  nearArray(vec4(state.data, OFF.ambient).slice(0, 3), [0.35, 0.35, 0.35], 1e-6, "默认环境光");
  nearArray(vec4(state.data, OFF.counts).slice(0, 3), [1, 0, 0], 1e-6, "默认方向光数量");
  nearArray(vec4(state.data, OFF.dirColor).slice(0, 3), [0.65, 0.65, 0.65], 1e-6, "默认方向光颜色");
  // 方向 = -normalize(0.35,0.75,0.55)
  const dir = vec4(state.data, OFF.dirDir);
  const len = Math.hypot(0.35, 0.75, 0.55);
  assert.ok(Math.abs(dir[0]! + 0.35 / len) < 1e-6);
  assert.ok(Math.abs(dir[1]! + 0.75 / len) < 1e-6);
  assert.ok(Math.abs(dir[2]! + 0.55 / len) < 1e-6);
});

test("collectLights：层级世界位置、隐藏灯语义、无灯时回退默认光", () => {
  const scene = new Scene();
  const parent = new Node3D();
  parent.setPosition(5, 2, -3);
  scene.add(parent);
  const child = new Node3D();
  child.setPosition(1, 0, 0);
  parent.add(child); // 点光挂在两层节点下

  const point = new PointLight("#ffffff", 3, 10, 2);
  child.add(point);
  const dir = new DirectionalLight(new Vec3(0.2, -1, 0), "#ffffff", 0.5);
  scene.add(dir);

  const state = new LightsState();
  const first = collectLights(scene, state);
  assert.equal(first.present, 2);
  assert.equal(first.count, 2);
  assert.equal(first.usedDefault, false);
  const pointPos = vec4(state.data, OFF.pointPos);
  nearArray(pointPos.slice(0, 3), [6, 2, -3], 1e-6, "点光世界位置应累加父节点变换");
  assert.equal(pointPos[3], 10, "range 应写入 w");

  // 全部隐藏 → 无光照（不回退默认光）
  point.visible = false;
  dir.visible = false;
  const hidden = collectLights(scene, state);
  assert.equal(hidden.present, 2, "灯节点仍存在");
  assert.equal(hidden.count, 0, "隐藏的灯不参与光照");
  assert.equal(hidden.usedDefault, false, "有灯节点时不应回退默认光");
  nearArray(vec4(state.data, OFF.counts).slice(0, 3), [0, 0, 0], 1e-6, "隐藏后数量");

  // 场景里没有灯 → 回退默认光
  const empty = new Scene();
  const none = collectLights(empty, state);
  assert.equal(none.usedDefault, true);
  nearArray(vec4(state.data, OFF.ambient).slice(0, 3), [0.35, 0.35, 0.35], 1e-6, "默认环境光");
});

test("SceneRenderer.render：把收集到的灯光喂给材质（含层级里的点光）", () => {
  const device = createMockDevice();
  const scene = new Scene();
  const lightNode = new Node3D();
  lightNode.setPosition(3, 4, 5);
  scene.add(lightNode);
  lightNode.add(new PointLight("#ff0000", 2, 7, 2));

  let receivedLights: LightsState | null = null;
  const material: MaterialLike = {
    beginFrame(_vp, _eye, lights) {
      if (lights) receivedLights = lights;
    },
    drawGeometry() {},
  };
  const mesh = new Mesh(Geometry.create(device, box(1, 1, 1)));
  mesh.material = material;
  scene.add(mesh);

  const camera = new Camera();
  camera.distance = 6;
  camera.update();
  const renderer = new SceneRenderer();
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({ colorAttachments: [], depthStencilAttachment: null });
  renderer.render(pass, scene, camera);
  pass.end();

  assert.ok(receivedLights, "材质应收到灯光状态");
  const lights = receivedLights as unknown as LightsState;
  nearArray(vec4(lights.data, OFF.counts).slice(0, 3), [0, 1, 0], 1e-6, "1 个点光");
  nearArray(vec4(lights.data, OFF.pointPos).slice(0, 3), [3, 4, 5], 1e-6, "点光世界位置");
  assert.equal(renderer.lightCount, 1);
  assert.equal(renderer.usedDefaultLights, false);

  // 场景里没有灯 → 自动使用默认光
  const emptyScene = new Scene();
  const mesh2 = new Mesh(Geometry.create(device, box(1, 1, 1)));
  mesh2.material = material;
  emptyScene.add(mesh2);
  const pass2 = device.createCommandEncoder().beginRenderPass({ colorAttachments: [], depthStencilAttachment: null });
  renderer.render(pass2, emptyScene, camera);
  pass2.end();
  assert.equal(renderer.usedDefaultLights, true);
  nearArray(vec4(lights.data, OFF.ambient).slice(0, 3), [0.35, 0.35, 0.35], 1e-6, "默认环境光");
  device.destroy();
});

test("灯节点：颜色/强度/方向设置与独立 id", () => {
  const a = new AmbientLight("#ff8800", 0.5);
  assert.ok(Math.abs(a.color.r - 1) < 1e-6 && Math.abs(a.color.g - 0.533) < 0.01, "十六进制颜色应写入");
  assert.equal(a.intensity, 0.5);

  const d = new DirectionalLight();
  d.setDirection(1, -2, 3);
  assert.deepEqual([d.direction.x, d.direction.y, d.direction.z], [1, -2, 3]);

  const s = new SpotLight("#ffffff", 2).setAngle(Math.PI / 8, 0.5);
  assert.equal(s.angle, Math.PI / 8);
  assert.equal(s.penumbra, 0.5);

  const p = new PointLight("#ffffff", 1, 12, 1.5);
  assert.equal(p.distance, 12);
  assert.equal(p.decay, 1.5);
  assert.notEqual(a.lightId, d.lightId, "每盏灯有独立 id");
});
