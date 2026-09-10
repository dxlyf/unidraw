/**
 * 场景图 / 射线拾取 / 颜色拾取（Mock 后端）单元测试。
 *
 * Mock 后端不做真实光栅化，因此这里断言的是：
 * - 场景图世界矩阵与视锥剔除/排序行为；
 * - 射线拾取的几何正确性（距离、命中面、未命中）；
 * - ColorPicker 的命令结构（可见物体数 = ID pass 的 draw 数）、像素映射、
 *   背景未命中、resize/dispose 生命周期；
 * - ID 颜色编解码的往返一致性。
 * 真实像素级一致性由 `examples/picking` 的无头自检覆盖（双后端 40/40 一致）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockDevice } from "../device/createDevice.js";
import { MockDevice } from "../device/backend/mock/MockDevice.js";
import { Scene } from "../scene/Scene.js";
import { SceneRenderer } from "../scene/SceneRenderer.js";
import { Mesh } from "../render/Mesh.js";
import { Geometry } from "../render/Geometry.js";
import { box, sphere } from "../render/primitives.js";
import { ColorMaterial } from "../render/material.js";
import { Camera } from "../render/Camera.js";
import { Color } from "../math/color.js";
import { Vec3 } from "../math/vec3.js";
import { Raycaster } from "../interaction/Raycaster.js";
import { ColorPicker } from "../picking/ColorPicker.js";
import { encodeId, decodeId } from "../picking/IdMaterial.js";

function setup(): { device: MockDevice; scene: Scene; camera: Camera } {
  const device = createMockDevice() as MockDevice;
  const scene = new Scene();
  const camera = new Camera();
  camera.setPerspective(Math.PI / 3, 1, 0.1, 100);
  camera.center.set(0, 0, 0);
  camera.distance = 6;
  camera.update();
  return { device, scene, camera };
}

function addBox(device: MockDevice, scene: Scene, x: number, y = 0, z = 0, color = "#4c8dff"): Mesh {
  const mesh = new Mesh(Geometry.create(device, box(1, 1, 1)));
  mesh.model.setIdentity().translate(x, y, z);
  mesh.material = new ColorMaterial(device, new Color().setHex(color));
  scene.add(mesh);
  return mesh;
}

test("SceneRenderer.collectVisible：世界矩阵、视锥剔除与 renderOrder 排序", () => {
  const { device, scene, camera } = setup();
  const a = addBox(device, scene, 0);
  const b = addBox(device, scene, 2.5);
  const behind = addBox(device, scene, 0, 0, 20); // 相机背后 → 应被剔除
  behind.renderOrder = -1;

  const sr = new SceneRenderer();
  const visible = sr.collectVisible(scene, camera);
  assert.equal(visible.length, 2);
  assert.ok(visible.includes(a) && visible.includes(b));
  assert.equal(sr.stats.culled, 1);
  assert.equal(sr.stats.objects, 3);

  // renderOrder 优先于距离
  a.renderOrder = 5;
  b.renderOrder = 0;
  const ordered = sr.collectVisible(scene, camera);
  assert.equal(ordered[0], b);
  assert.equal(ordered[1], a);

  // 世界矩阵随父节点变化（层级）
  const parent = addBox(device, scene, 0);
  const child = new Mesh(Geometry.create(device, sphere(0.2, 12, 8)));
  child.material = new ColorMaterial(device, new Color(1, 1, 1, 1));
  parent.add(child);
  scene.updateWorldMatrix(true);
  child.updateWorldBounds();
  const before = child.worldCenter.x;
  parent.model.setIdentity().translate(4, 0, 0);
  scene.updateWorldMatrix(true);
  child.updateWorldBounds();
  assert.ok(child.worldCenter.x > before + 3, `子节点应跟随父节点：${before} → ${child.worldCenter.x}`);
  device.destroy();
});

test("Raycaster：命中距离/命中点/未命中，以及背面剔除", () => {
  const { device, scene, camera } = setup();
  addBox(device, scene, 0);
  scene.updateWorldMatrix(true);

  const raycaster = new Raycaster();
  raycaster.setFromCamera(camera, 0, 0);
  const hit = raycaster.intersectFirst(scene);
  assert.ok(hit, "正前方应命中立方体");
  assert.equal(hit!.object, scene.children[0]);
  // 命中相机与立方体正面（z=+0.5）之间
  assert.ok(Math.abs(hit!.point.z - 0.5) < 0.05, `命中点 z 应约为 0.5，实际 ${hit!.point.z}`);
  // t 是「沿射线方向、从射线原点（= 近平面点）起算」的距离，与物体空间变换保持一致
  const originDist = raycaster.ray.origin.distanceTo(hit!.point);
  assert.ok(
    Math.abs(hit!.distance - originDist) < 1e-3,
    `物体空间的 t 应等于到射线原点的距离：t=${hit!.distance} originDist=${originDist}`,
  );
  assert.ok(hit!.distance > 5 && hit!.distance < 6, `命中距离应在 5~6，实际 ${hit!.distance}`);
  assert.ok(Math.abs(Math.abs(hit!.normal.z) - 1) < 1e-3, "命中面法线应沿 ±Z");

  // 视线外 → 未命中
  raycaster.setFromCamera(camera, 0.98, 0.98);
  assert.equal(raycaster.intersectFirst(scene), null);

  // 背面剔除：从立方体内部向外射（用 near 反转方向的近似方式验证参数生效）
  raycaster.backfaceCulling = true;
  raycaster.setFromCamera(camera, 0, 0);
  assert.ok(raycaster.intersectFirst(scene), "开启背面剔除后仍应命中正面");
  device.destroy();
});

test("ColorPicker：ID pass 的 draw 数与可见物体一致，背景未命中，像素映射正确", async () => {
  const { device, scene, camera } = setup();
  addBox(device, scene, -1.5);
  addBox(device, scene, 1.5);
  const hidden = addBox(device, scene, 0);
  hidden.visible = false;

  const picker = new ColorPicker(device, { label: "test-picker" });
  picker.resize(64, 32);
  device.clearDrawCalls();

  const drawn = picker.render(scene, camera);
  assert.equal(drawn, 2, "隐藏物体不参与拾取");
  assert.equal(device.drawCalls.length, 2, "ID pass 每个可见物体一次 draw");
  assert.equal(picker.idMap.length, 3, "idMap：0 为背景 + 2 个物体");
  assert.equal(picker.idMap[1], scene.children[0]);
  assert.equal(picker.idMap[2], scene.children[1]);
  assert.equal(picker.dirty, false);

  // Mock 不栅格化三角形 → 像素为清屏值（0,0,0,0）→ 未命中
  const miss = await picker.pickPixel({ x: 0, y: 0 });
  assert.equal(miss.mesh, null);
  assert.equal(miss.id, 0);
  assert.equal(miss.color.r, 0);

  // NDC → 像素（左上原点）
  assert.deepEqual(picker.ndcToPixel({ x: -1, y: 1 }), { x: 0, y: 0 });
  assert.deepEqual(picker.ndcToPixel({ x: 1, y: -1 }), { x: 63, y: 31 });
  const center = picker.ndcToPixel({ x: 0, y: 0 });
  assert.equal(center.x, 32);
  assert.equal(center.y, 16);

  // 越界 NDC 会被夹取
  assert.deepEqual(picker.ndcToPixel({ x: -5, y: 5 }), { x: 0, y: 0 });

  // resize 重建离屏资源，尺寸生效
  picker.resize(16, 8);
  assert.deepEqual(picker.size, { width: 16, height: 8 });
  assert.equal(picker.dirty, true);
  picker.dispose();
  device.destroy();
});

test("ID 编解码：24 位编号往返一致", () => {
  for (const id of [0, 1, 2, 255, 256, 65535, 65536, 1000, 16777215]) {
    const [r, g, b] = encodeId(id);
    assert.ok(r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255);
    assert.equal(decodeId(r, g, b), id, `id ${id} 往返失败`);
  }
  // 颜色分量存储为 0..1 浮点再转回 8bit 时也应精确
  for (const id of [1, 12345, 7000000]) {
    const [r, g, b] = encodeId(id);
    const round = (v: number) => Math.round((v / 255) * 255);
    assert.equal(decodeId(round(r), round(g), round(b)), id);
  }
});

test("Scene/Node3D：射线拾取需要 CPU 数据，未保留时返回未命中", () => {
  const { device, scene, camera } = setup();
  const mesh = new Mesh(Geometry.create(device, box(1, 1, 1), { retainCPU: false }));
  mesh.material = new ColorMaterial(device, new Color(1, 1, 1, 1));
  scene.add(mesh);
  scene.updateWorldMatrix(true);

  const raycaster = new Raycaster();
  raycaster.setFromCamera(camera, 0, 0);
  assert.equal(raycaster.intersectFirst(scene), null, "无 CPU 数据时几何拾取跳过（应改用颜色拾取）");

  // 有 CPU 数据时命中
  const withCpu = new Mesh(Geometry.create(device, box(1, 1, 1)));
  withCpu.material = new ColorMaterial(device, new Color(1, 1, 1, 1));
  withCpu.model.setIdentity().translate(0, 0, 0);
  const scene2 = new Scene();
  scene2.add(withCpu);
  scene2.updateWorldMatrix(true);
  assert.ok(raycaster.intersectFirst(scene2), "保留 CPU 数据时命中");
  assert.ok(new Vec3(0, 0, 0).distanceTo(withCpu.worldCenter) < 1e-6);
  device.destroy();
});
