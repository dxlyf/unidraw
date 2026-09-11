/**
 * 阴影（Shadow Map）单元测试：参数、贴合矩阵、打包、贴图池、深度 pass 与材质绑定。
 *
 * Mock 后端不栅格化，但会记录每个 pass 的 draw 并校验管线/附件格式，
 * 因此足以断言「有几个阴影 pass、每个 pass 绑了什么、贴图参数对不对」。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockDevice } from "../device/createDevice.js";
import type { MockDevice } from "../device/backend/mock/MockDevice.js";
import { Scene } from "../scene/Scene.js";
import { SceneRenderer } from "../scene/SceneRenderer.js";
import { App } from "../app/App.js";
import { Camera } from "../render/Camera.js";
import { Mesh } from "../render/Mesh.js";
import { Geometry } from "../render/Geometry.js";
import { box } from "../render/primitives.js";
import { Color } from "../math/color.js";
import { Vec3 } from "../math/vec3.js";
import { Mat4 } from "../math/mat4.js";
import { ColorMaterial } from "../render/material.js";
import { AmbientLight, DirectionalLight, SpotLight } from "../render/lights/index.js";
import { ShadowCamera } from "../render/shadow/ShadowCamera.js";
import { ShadowDepthMaterial } from "../render/shadow/ShadowDepthMaterial.js";
import { ShadowMap, SHADOW_DEPTH_FORMAT } from "../render/shadow/ShadowMap.js";
import { ShadowRenderer } from "../render/shadow/ShadowRenderer.js";
import { ShadowSettings, normalizeShadowFilter, shadowFilterCode } from "../render/shadow/ShadowSettings.js";
import {
  MAX_SHADOW_MAPS,
  SHADOW_BLOCK_BINDING,
  SHADOW_KIND_DIRECTIONAL,
  SHADOW_KIND_SPOT,
  SHADOW_SAMPLER_BINDING,
  SHADOW_TEXTURE_BINDING,
  ShadowState,
} from "../render/shadow/index.js";
import { shadowResources } from "../render/shadow/ShadowResources.js";
import { TextureUsage } from "../gpu/types.js";

function buildScene(
  device: MockDevice,
  options: { sun?: boolean; spot?: boolean; boxes?: number } = {},
): {
  scene: Scene;
  sun: DirectionalLight;
  spot: SpotLight;
  camera: Camera;
} {
  const scene = new Scene();
  scene.add(new AmbientLight("#404a66", 0.4));
  const sun = new DirectionalLight(new Vec3(-0.5, -1, -0.4), "#ffffff", 1);
  sun.castShadow = true;
  scene.add(sun);
  const spot = new SpotLight("#ffffff", 5);
  spot.setPosition(2, 5, 2);
  spot.setDirection(-0.4, -1, -0.4);
  spot.castShadow = true;
  scene.add(spot);
  if (options.sun === false) sun.castShadow = false;
  if (options.spot === false) spot.castShadow = false;
  const count = options.boxes ?? 3;
  const material = new ColorMaterial(device, new Color(0.8, 0.4, 0.2, 1), { label: "test-box" });
  for (let i = 0; i < count; i++) {
    const mesh = new Mesh(Geometry.create(device, box(1, 1, 1)));
    mesh.setPosition((i - 1) * 2, 0.5, 0);
    mesh.material = material;
    scene.add(mesh);
  }
  const camera = new Camera();
  camera.setPerspective(1, 1, 0.1, 100);
  camera.distance = 8;
  camera.pitch = 0.4;
  camera.update();
  return { scene, sun, spot, camera };
}

test("ShadowSettings：默认值、clamp 与 Light.setShadow", () => {
  const s = new ShadowSettings();
  assert.equal(s.enabled, true);
  assert.equal(s.mapSize, 1024);
  assert.ok(s.bias > 0, "bias 缺省为正（世界单位）");
  assert.equal(s.normalBias, 0, "normalBias 缺省 0 = 按纹素自动");
  assert.ok(s.radius > 0);
  assert.equal(s.filter, "pcf3", "缺省 3x3 PCF");
  assert.equal(s.intensity, 1, "缺省阴影全强度");
  assert.equal(s.side, "back", "缺省渲染背面（抗自阴影）");
  assert.equal(s.stabilize, true, "缺省平滑拟合（消除闪烁）");
  assert.equal(s.near, 0, "near 缺省 0 = 自动拟合");
  assert.equal(s.far, 0);
  assert.equal(s.areaSize, 0);

  assert.equal(new ShadowSettings({ mapSize: 99999 }).mapSize, 4096, "贴图边长有上限");
  assert.equal(new ShadowSettings({ mapSize: 1 }).mapSize, 64, "贴图边长有下限");
  assert.equal(new ShadowSettings({ radius: -5 }).radius, 0, "PCF 半径不为负");
  assert.equal(new ShadowSettings({ intensity: 5 }).intensity, 1, "强度 clamp 到 1");
  assert.equal(new ShadowSettings({ intensity: -1 }).intensity, 0);
  assert.equal(new ShadowSettings({ side: "double" }).side, "double");
  assert.equal(new ShadowSettings({ side: "随便" as never }).side, "back", "未知 side 回退");
  assert.equal(normalizeShadowFilter("pcf5"), "pcf5");
  assert.equal(normalizeShadowFilter("不存在"), "pcf3", "未知滤波回退 pcf3");

  // 面选项 → 剔除模式（阴影 pass 用反向剔除：渲染背面 = 剔除正面）
  assert.equal(new ShadowSettings({ side: "back" }).cullModeForSide(), "front");
  assert.equal(new ShadowSettings({ side: "front" }).cullModeForSide(), "back");
  assert.equal(new ShadowSettings({ side: "double" }).cullModeForSide(), "none");
  assert.equal(shadowFilterCode("hard"), 0);
  assert.equal(shadowFilterCode("pcf5"), 2);

  const light = new DirectionalLight();
  assert.equal(light.castShadow, false, "默认不投影");
  light.setShadow({ mapSize: 2048, bias: 0.005 });
  assert.equal(light.castShadow, true);
  assert.equal(light.shadow.mapSize, 2048);
  assert.equal(light.shadow.bias, 0.005);
  light.setShadow({ enabled: false });
  assert.equal(light.castShadow, false);
});

test("ShadowMap：深度贴图参数、附件与 resize", () => {
  const device = createMockDevice();
  const map = new ShadowMap(device, { index: 0, size: 512, label: "test-map" });
  assert.equal(map.size, 512);
  assert.equal(map.texture.format, SHADOW_DEPTH_FORMAT);
  assert.equal(map.texture.width, 512);
  assert.ok((map.texture.usage & TextureUsage.RENDER_ATTACHMENT) !== 0);
  assert.ok((map.texture.usage & TextureUsage.TEXTURE_BINDING) !== 0, "阴影贴图必须可采样");

  const att = map.depthAttachment();
  assert.equal(att.view, map.texture.view());
  assert.equal(att.depthLoadOp, "clear");
  assert.equal(att.depthClearValue, 1, "清成最远");
  assert.equal(att.sampleCount, 1);

  const before = map.texture;
  assert.equal(map.resize(512), false, "尺寸没变不重建");
  assert.equal(map.resize(1024), true);
  assert.equal(map.size, 1024);
  assert.notEqual(map.texture, before);
  map.dispose();
});

test("ShadowState：std140 打包（矩阵/参数/数量）", () => {
  const device = createMockDevice();
  const state = new ShadowState();
  const matrix = Mat4.identity().translate(1, 2, 3);
  const map = new ShadowMap(device, { index: 0, size: 512 });
  map.matrix.copy(matrix);

  assert.equal(state.add(map, SHADOW_KIND_DIRECTIONAL, 1, { bias: 0.002, radius: 2, normalBias: 0.05 }), true);
  state.finish();

  // u_shadowMatrix[0] 在偏移 0（16 个 float），u_shadowParams[0] 在 64 之后
  assert.deepEqual(Array.from(state.data.slice(12, 16)), [1, 2, 3, 1], "矩阵平移列");
  const paramsOffset = 4 * 16;
  assert.ok(Math.abs(state.data[paramsOffset]! - 0.002) < 1e-7, "x = 深度偏移");
  assert.ok(Math.abs(state.data[paramsOffset + 1]! - 1 / 512) < 1e-9, "y = 1/边长");
  assert.equal(state.data[paramsOffset + 2], SHADOW_KIND_DIRECTIONAL);
  assert.equal(state.data[paramsOffset + 3], 1, "光源序号");
  const params2Offset = paramsOffset + 4 * 4;
  assert.equal(state.data[params2Offset], 2, "PCF 半径");
  assert.ok(Math.abs(state.data[params2Offset + 1]! - 0.05) < 1e-7, "法线偏移");
  assert.equal(state.data[state.data.length - 4], 1, "u_shadowMeta.x = 贴图数量");
  assert.equal(state.count, 1);
  assert.equal(state.maps[0], map);

  // 超出上限
  for (let i = 1; i < MAX_SHADOW_MAPS; i++) {
    const extra = new ShadowMap(device, { index: i });
    assert.equal(state.add(extra, SHADOW_KIND_SPOT, i, { bias: 0, radius: 0, normalBias: 0 }), true);
  }
  assert.equal(state.add(new ShadowMap(device, { index: 99 }), SHADOW_KIND_SPOT, 9, { bias: 0, radius: 0, normalBias: 0 }), false);
  assert.equal(state.count, MAX_SHADOW_MAPS);
  state.finish();
  assert.equal(state.data[state.data.length - 4], MAX_SHADOW_MAPS);

  state.reset();
  assert.equal(state.count, 0);
  assert.equal(state.data[state.data.length - 4], 0);
});

test("ShadowCamera：方向光正交拟合（覆铜球 + 纹素对齐 + 深度递增）", () => {
  const camera = new ShadowCamera();
  const center = new Vec3(0, 0, 0);
  const direction = new Vec3(-0.5, -1, -0.4);
  const radius = 4;
  const m = camera.fitDirectional(direction, center, radius, 512, 0, 0, 1.5);
  const project = (p: Vec3): [number, number, number] => {
    const e = m.elements;
    const x = e[0]! * p.x + e[4]! * p.y + e[8]! * p.z + e[12]!;
    const y = e[1]! * p.x + e[5]! * p.y + e[9]! * p.z + e[13]!;
    const z = e[2]! * p.x + e[6]! * p.y + e[10]! * p.z + e[14]!;
    const w = e[3]! * p.x + e[7]! * p.y + e[11]! * p.z + e[15]!;
    return [x / w, y / w, z / w];
  };
  const [cx, cy, cz] = project(center);
  assert.ok(Math.abs(cx) < 0.05 && Math.abs(cy) < 0.05, "场景中心应在阴影贴图中心附近");
  assert.ok(cz > 0 && cz < 1, "ZO 投影：中心深度在 (0,1)");

  // 包围球表面上的点都必须落在裁剪体里
  for (const p of [
    new Vec3(radius, 0, 0),
    new Vec3(-radius, 0, 0),
    new Vec3(0, radius, 0),
    new Vec3(0, -radius, 0),
    new Vec3(0, 0, radius),
    new Vec3(0, 0, -radius),
  ]) {
    const [x, y, z] = project(p);
    assert.ok(Math.abs(x) <= 1.001 && Math.abs(y) <= 1.001, `点 ${p.toString()} 超出 x/y 裁剪范围`);
    assert.ok(z >= -0.001 && z <= 1.001, `点 ${p.toString()} 超出深度范围`);
  }

  // 离光源更远的点深度更大（深度测试方向正确）
  const near = project(new Vec3(0, 0, 0));
  const far = project(new Vec3(direction.x * 2, direction.y * 2, direction.z * 2));
  assert.ok(far[2] > near[2], "沿光源反方向的点更深");

  // 纹素对齐：光源位置投影到光空间的 right/up 轴上应落在纹素网格上
  const texelWorld = (2 * radius) / 512;
  const up = new Vec3(0, 1, 0);
  const right = new Vec3(
    direction.y * up.z - direction.z * up.y,
    direction.z * up.x - direction.x * up.z,
    direction.x * up.y - direction.y * up.x,
  );
  const rl = right.length() || 1;
  right.set(right.x / rl, right.y / rl, right.z / rl);
  const dotRight = camera.eye.x * right.x + camera.eye.y * right.y + camera.eye.z * right.z;
  const residual = dotRight / texelWorld - Math.round(dotRight / texelWorld);
  assert.ok(Math.abs(residual) < 1e-6, "光源位置在 right 轴上对齐到纹素网格");

  // 沿光方向平移中心不应改变「平面内」的对齐结果（只影响深度方向）
  const shifted = new ShadowCamera().fitDirectional(
    direction,
    new Vec3(direction.x * 0.01, direction.y * 0.01, direction.z * 0.01),
    radius,
    512,
    0,
    0,
    1.5,
  );
  assert.ok(Math.abs(shifted.elements[12]! - m.elements[12]!) < 1e-9, "平面内平移（x）不受沿光方向位移影响");
  assert.ok(Math.abs(shifted.elements[13]! - m.elements[13]!) < 1e-9, "平面内平移（y）不受沿光方向位移影响");
});

test("ShadowCamera：聚光透视拟合（中轴 → uv 中心，背后剔除）", () => {
  const camera = new ShadowCamera();
  const position = new Vec3(0, 5, 0);
  const direction = new Vec3(0, -1, 0);
  const m = camera.fitSpot(position, direction, Math.PI / 8, 0.1, 40);
  const project = (x: number, y: number, z: number): [number, number, number, number] => {
    const e = m.elements;
    const cx = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
    const cy = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
    const cz = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
    const cw = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
    return [cx / cw, cy / cw, cz / cw, cw];
  };
  const [x, y, z, w] = project(0, 0, 0);
  assert.ok(Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6, "中轴上的点投影到 uv 中心");
  assert.ok(z > 0 && z < 1 && w > 0, "中轴点深度有效");
  // 光源上方（背后）
  const behind = project(0, 6, 0);
  assert.ok(behind[3] <= 0, "光源背后的点 w <= 0（着色器据此跳过）");
});

test("ShadowResources：贴图池按需创建、version 自增、占位纹理", () => {
  const device = createMockDevice();
  const res = shadowResources(device);
  const v0 = res.version;
  assert.equal(res.maps.length, 0);
  assert.ok(res.placeholder, "占位深度纹理始终存在");
  assert.equal(res.mapView(0), res.placeholder.view(), "没有贴图时绑定占位");

  const map0 = res.acquire(0, 1024);
  assert.equal(res.version, v0 + 1, "首次 acquire 提升 version（材质据此重建 bind group）");
  assert.equal(res.mapView(0), map0.texture.view());
  assert.equal(res.acquire(0, 1024), map0, "重复 acquire 返回同一张");
  assert.equal(res.version, v0 + 1, "尺寸没变不再提升 version");
  res.acquire(0, 512);
  assert.equal(map0.size, 512);
  assert.equal(res.version, v0 + 2, "resize 提升 version");

  const map2 = res.acquire(2, 256);
  assert.equal(map2.index, 2);
  assert.equal(res.mapView(1), res.placeholder.view(), "未创建的槽位仍是占位");
});

test("ShadowRenderer：Mock 后端逐灯渲染深度 pass（每张贴图一个深度材质）", () => {
  const device = createMockDevice();
  const { scene, camera } = buildScene(device);
  const sceneRenderer = new SceneRenderer();
  const renderer = new ShadowRenderer(device, { mapSize: 256 });
  const encoder = device.createCommandEncoder("shadow");
  const count = renderer.render(encoder, scene, camera, sceneRenderer);
  device.submit([encoder.finish()]);

  assert.equal(count, 2, "方向光 + 聚光各一张");
  assert.equal(renderer.stats.maps, 2);
  assert.equal(renderer.stats.skipped, 0);
  assert.equal(renderer.stats.drawn, 6, "两个 pass × 3 个立方体");
  assert.equal(device.passCount, 2, "两个只写深度的 pass");
  assert.equal(device.drawCalls.length, 6);

  // 每张贴图一个深度材质（相机 UBO 是立即写入的，共用会让所有 pass 都用最后一张的矩阵）
  assert.notEqual(renderer.materialAt(0), renderer.materialAt(1));
  assert.equal(renderer.material, renderer.materialAt(0), "material 指向第 0 张");

  // 打包数据：2 张贴图 + 类型/序号
  const state = renderer.resources.state;
  const paramsOffset = 4 * 16;
  assert.equal(state.data[state.data.length - 4], 2, "u_shadowMeta.x = 2");
  assert.equal(state.data[paramsOffset + 2], SHADOW_KIND_DIRECTIONAL);
  assert.equal(state.data[paramsOffset + 3], 0);
  assert.equal(state.data[paramsOffset + 4 + 2], SHADOW_KIND_SPOT, "第二张是聚光");
  assert.equal(state.data[paramsOffset + 4 + 3], 0, "聚光序号 0");

  // clear()：立刻退回「无阴影」
  renderer.clear();
  assert.equal(renderer.resources.state.count, 0);
  assert.equal(renderer.resources.state.data[renderer.resources.state.data.length - 4], 0);
});

test("ShadowRenderer：关灯/关阴影/超出上限的行为", () => {
  const device = createMockDevice();
  const sceneRenderer = new SceneRenderer();
  const renderer = new ShadowRenderer(device);

  const noShadow = buildScene(device, { sun: false, spot: false });
  const encoder = device.createCommandEncoder("s0");
  assert.equal(renderer.render(encoder, noShadow.scene, noShadow.camera, sceneRenderer), 0);
  assert.equal(renderer.stats.maps, 0);
  device.submit([encoder.finish()]);
  assert.equal(device.passCount, 0);

  // enabled = false 时完全不产生 pass（并把打包数据清零）
  renderer.enabled = false;
  const some = buildScene(device);
  const enc2 = device.createCommandEncoder("s1");
  assert.equal(renderer.render(enc2, some.scene, some.camera, sceneRenderer), 0);
  assert.equal(renderer.resources.state.data[renderer.resources.state.data.length - 4], 0);

  // 超出 MAX_SHADOW_MAPS 的灯被跳过并计数
  renderer.enabled = true;
  const many = new Scene();
  const cam = new Camera();
  cam.update();
  const material = new ColorMaterial(device, new Color(1, 1, 1, 1), { label: "m" });
  const mesh = new Mesh(Geometry.create(device, box(1, 1, 1)));
  mesh.material = material;
  many.add(mesh);
  for (let i = 0; i <= MAX_SHADOW_MAPS; i++) {
    const light = new DirectionalLight(new Vec3(-1, -1, 0), "#ffffff", 1);
    light.castShadow = true;
    many.add(light);
  }
  const enc3 = device.createCommandEncoder("s2");
  assert.equal(renderer.render(enc3, many, cam, sceneRenderer), MAX_SHADOW_MAPS);
  assert.equal(renderer.stats.skipped, 1);
});

test("材质绑定：受光材质声明阴影槽位，深度材质不声明", () => {
  const device = createMockDevice();
  const lit = new ColorMaterial(device, new Color(1, 1, 1, 1), { label: "lit" });
  const bindings = lit.bindGroupResource.descriptor.entries.map((e) => e.binding).sort((a, b) => a - b);
  assert.ok(bindings.includes(SHADOW_BLOCK_BINDING), "受光材质绑定 ShadowBlock");
  for (let i = 0; i < MAX_SHADOW_MAPS; i++) {
    assert.ok(bindings.includes(SHADOW_TEXTURE_BINDING + i), `绑定阴影贴图 ${i}`);
    assert.ok(bindings.includes(SHADOW_SAMPLER_BINDING + i), `绑定阴影采样器 ${i}`);
  }

  const depth = new ShadowDepthMaterial(device);
  const depthBindings = depth.bindGroupResource.descriptor.entries.map((e) => e.binding);
  assert.equal(depthBindings.includes(SHADOW_BLOCK_BINDING), false, "深度 pass 不能绑定阴影贴图（WebGPU 读写冲突）");
  // 深度管线没有颜色附件
  assert.deepEqual(depth.pipelineHandle.descriptor.targets, []);
  assert.equal(depth.pipelineHandle.descriptor.depthStencil?.depthWriteEnabled, true);
  assert.equal(depth.pipelineHandle.descriptor.primitive?.cullMode, "front");

  // WebGL2 侧的纹理/采样器必须按顺序配对：layout 里采样器数量应等于纹理数量
  const layout = lit.layoutEntries;
  assert.equal(
    layout.filter((e) => e.type === "texture").length,
    layout.filter((e) => e.type === "sampler").length,
    "WebGL2 的纹理/采样器按顺序配对，数量必须一致",
  );
});

test("App：shadows 选项每帧自动渲染阴影 pass", async () => {
  const device = createMockDevice();
  const canvas = {
    width: 128,
    height: 128,
    clientWidth: 128,
    clientHeight: 128,
    style: {},
    addEventListener() {},
    removeEventListener() {},
    setPointerCapture() {},
    releasePointerCapture() {},
  } as unknown as HTMLCanvasElement;
  const app = App.fromDevice(device, canvas, { input: false, autoResize: false, shadows: true, shadowMapSize: 256 });
  assert.ok(app.shadows, "shadows: true 应创建 ShadowRenderer");

  const light = new DirectionalLight(new Vec3(-0.5, -1, -0.4), "#ffffff", 1);
  light.castShadow = true;
  app.scene.add(light);
  app.scene.add(new AmbientLight("#404a66", 0.4));
  const mesh = new Mesh(Geometry.create(device, box(1, 1, 1)));
  mesh.material = new ColorMaterial(device, new Color(0.8, 0.4, 0.2, 1), { label: "app-box" });
  app.scene.add(mesh);

  device.clearDrawCalls();
  app.step(1 / 60);
  assert.equal(app.shadows!.stats.maps, 1, "每帧渲染 1 张阴影贴图");
  assert.equal(app.shadows!.stats.drawn, 1, "阴影 pass 画了 1 个物体");
  // pass 数 = 阴影 + 画布
  assert.equal(device.passCount, 2);
  app.dispose();
});

test("SceneRenderer.collectVisible：viewProjection 覆盖剔除矩阵（光源视角）", () => {
  const device = createMockDevice();
  const { scene, camera } = buildScene(device, { boxes: 2 });
  const sceneRenderer = new SceneRenderer();
  // 主相机反向（背对场景）→ 全部剔除
  const away = new Camera();
  away.center.set(0, 0, 0);
  away.distance = 8;
  away.yaw = Math.PI; // 转到背面
  away.update();
  sceneRenderer.collectVisible(scene, away);
  assert.equal(sceneRenderer.stats.drawn, 0, "背面相机看不到物体");

  // 用光源矩阵覆盖剔除：方向光的阴影相机覆盖整个场景 → 全部可见
  const shadowCamera = new ShadowCamera();
  const lightMatrix = shadowCamera.fitDirectional(new Vec3(-0.5, -1, -0.4), new Vec3(0, 0, 0), 4, 512, 0, 0, 1.5);
  const visible = sceneRenderer.collectVisible(scene, away, { viewProjection: lightMatrix, sort: false });
  assert.equal(visible.length, 2, "按光源视锥剔除时 2 个立方体都可见");
  assert.ok(camera.viewProjection);

  // 反向验证：光源视锥之外（把半径缩到很小且平移）会被剔除
  const tiny = new ShadowCamera();
  const tinyMatrix = tiny.fitDirectional(new Vec3(-1, 0, 0), new Vec3(50, 0, 0), 1, 512, 0, 0, 1.5);
  const culled = sceneRenderer.collectVisible(scene, camera, { viewProjection: tinyMatrix });
  assert.equal(culled.length, 0, "视锥外的物体被剔除");
});

test("Mat4.ortho：ZO 约定（near → 0, far → 1）", () => {  const m = Mat4.ortho(-1, 1, -1, 1, 1, 11);
  const z = (viewZ: number): number => {
    const e = m.elements;
    return (e[10]! * viewZ + e[14]!) / (e[11]! * viewZ + e[15]!);
  };
  assert.ok(Math.abs(z(-1) - 0) < 1e-6, "近平面 z = 0");
  assert.ok(Math.abs(z(-11) - 1) < 1e-6, "远平面 z = 1");
  assert.ok(Math.abs(z(-6) - 0.5) < 1e-6, "中点 z = 0.5");
});

test("ShadowRenderer：bias 以世界单位换算、法线偏移按纹素自动、诊断字段可读", () => {
  const device = createMockDevice();
  const { scene, camera } = buildScene(device, { sun: true, spot: false, boxes: 2 });
  const sceneRenderer = new SceneRenderer();
  const renderer = new ShadowRenderer(device, { mapSize: 512 });
  const sun = scene.children.find((n) => n instanceof DirectionalLight) as DirectionalLight;
  sun.shadow.bias = 0.05;         // 世界单位
  sun.shadow.normalBias = 0;      // 自动
  sun.shadow.filter = "pcf5";
  sun.shadow.intensity = 0.6;
  sun.shadow.side = "front";

  const encoder = device.createCommandEncoder("fit");
  renderer.render(encoder, scene, camera, sceneRenderer, 1 / 60);
  device.submit([encoder.finish()]);

  const map = renderer.resources.maps[0]!;
  assert.ok(map.nearPlane > 0 && map.farPlane > map.nearPlane, "记录深度范围");
  assert.ok(map.texelWorld > 0, "记录纹素世界尺寸");
  assert.equal(map.viewSide, "front", "记录渲染面");
  assert.ok(renderer.stats.texelWorld > 0 && renderer.stats.biasDepth > 0);

  // 打包参数：bias 归一化深度 = 世界偏移 / 深度范围；法线偏移按 1.5 纹素自动
  const state = renderer.resources.state;
  const paramsOffset = 4 * 16;
  const params2Offset = paramsOffset + 4 * MAX_SHADOW_MAPS;
  const expectedBias = 0.05 / (map.farPlane - map.nearPlane);
  assert.ok(Math.abs(state.data[paramsOffset]! - expectedBias) < 1e-6, "bias 已换算成归一化深度");
  assert.ok(Math.abs(state.data[params2Offset + 1]! - map.texelWorld * 1.5) < 1e-6, "法线偏移按 1.5 纹素自动");
  assert.equal(state.data[params2Offset + 2], shadowFilterCode("pcf5"), "滤波方式打包");
  assert.ok(Math.abs(state.data[params2Offset + 3]! - 0.6) < 1e-6, "阴影强度打包");

  // 不同 side 使用不同的深度材质（剔除模式不同）
  const backSide = renderer.materialFor(0, "back");
  const frontSide = renderer.materialFor(0, "front");
  const doubleSide = renderer.materialFor(0, "double");
  assert.notEqual(backSide, frontSide);
  assert.notEqual(frontSide, doubleSide);
  assert.equal(backSide.pipelineHandle.descriptor.primitive?.cullMode, "front");
  assert.equal(frontSide.pipelineHandle.descriptor.primitive?.cullMode, "back");
  assert.equal(doubleSide.pipelineHandle.descriptor.primitive?.cullMode, "none");
});

test("ShadowRenderer：拟合稳定（变大立刻跟随、变小平滑收敛、中心量化）", () => {
  const device = createMockDevice();
  const { scene, camera } = buildScene(device, { sun: true, spot: false, boxes: 2 });
  const sceneRenderer = new SceneRenderer();
  const renderer = new ShadowRenderer(device, { mapSize: 512, stabilizeTau: 0.3 });
  const sun = scene.children.find((n) => n instanceof DirectionalLight) as DirectionalLight;
  sun.shadow.stabilize = true;

  const step = (): void => {
    const encoder = device.createCommandEncoder("s");
    renderer.render(encoder, scene, camera, sceneRenderer, 1 / 60);
    device.submit([encoder.finish()]);
  };

  step();
  const firstRadius = renderer.boundsRadius;
  // 相机与场景都没变 → 拟合半径必须完全不变（否则采样网格会跳）
  for (let i = 0; i < 10; i++) step();
  assert.equal(renderer.boundsRadius, firstRadius, "静止场景的拟合半径不漂移");

  // 加入一个远处的物体（关闭剔除，保证它进入可见集合）→ 半径立刻变大（不能漏阴影）
  sceneRenderer.frustumCulling = false;
  const big = new ColorMaterial(device, new Color(1, 1, 1, 1), { label: "big" });
  const mesh = new Mesh(Geometry.create(device, box(1, 1, 1)));
  mesh.setPosition(40, 0, 0);
  mesh.material = big;
  scene.add(mesh);
  step();
  assert.ok(renderer.boundsRadius > firstRadius, "变大立刻跟随");
  const grown = renderer.boundsRadius;

  // 移除它 → 半径平滑收敛而不是瞬间跳回（纹素尺寸量化会让它先在阶梯上停留若干帧）
  scene.remove(mesh);
  step();
  assert.ok(renderer.boundsRadius <= grown, "一帧内不增大");
  for (let i = 0; i < 240; i++) step();
  assert.ok(renderer.boundsRadius < grown, "最终收敛下来");
  assert.ok(renderer.boundsRadius <= firstRadius * 2.5 + 1e-3, "收敛到接近原尺寸（含一个量化阶梯的余量）");
});
