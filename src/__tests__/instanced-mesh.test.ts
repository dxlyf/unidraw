/**
 * InstancedMesh 单元测试：实例矩阵、批量上传、联合包围球、一次绘制、
 * 以及「材质不支持实例化时退化成 N 次绘制」的正确性兜底。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockDevice } from "../device/createDevice.js";
import type { MockDevice } from "../device/backend/mock/MockDevice.js";
import { InstancedMesh } from "../render/InstancedMesh.js";
import { Geometry } from "../render/Geometry.js";
import { box } from "../render/primitives.js";
import { ColorMaterial } from "../render/material.js";
import { Color } from "../math/color.js";
import { Mat4 } from "../math/mat4.js";
import { Camera } from "../render/Camera.js";
import { Scene } from "../scene/Scene.js";
import { SceneRenderer } from "../scene/SceneRenderer.js";
import { INSTANCE_VERTEX_SLOT } from "../render/materialCommon.js";
import type { MaterialLike } from "../scene/types.js";
import type { RenderPassEncoder } from "../command/encoder.js";
import type { Geometry as GeometryType } from "../render/Geometry.js";

function makeInstanced(device: MockDevice, count = 4): { mesh: InstancedMesh; material: ColorMaterial } {
  const material = new ColorMaterial(device, new Color(1, 1, 1, 1), { label: "inst-material" });
  const mesh = new InstancedMesh(Geometry.create(device, box(1, 1, 1)), material, count, { label: "inst" });
  for (let i = 0; i < count; i++) mesh.setPositionAt(i, i * 2, 0, 0);
  return { mesh, material };
}

test("InstancedMesh：实例矩阵读写与容量约束", () => {
  const device = createMockDevice();
  const material = new ColorMaterial(device, new Color(1, 1, 1, 1));
  const mesh = new InstancedMesh(Geometry.create(device, box(1, 1, 1)), material, 3);
  assert.equal(mesh.capacity, 3);
  assert.equal(mesh.instanceCount, 3, "默认全部绘制");
  assert.ok(mesh.instanceBuffer.size >= 3 * 64, "实例缓冲按 64B/实例分配");

  // 默认单位矩阵
  const m = mesh.getMatrixAt(1);
  assert.deepEqual(Array.from(m.elements), Array.from(new Mat4().elements));

  const t = Mat4.identity().translate(5, 1, -2);
  mesh.setMatrixAt(1, t);
  assert.deepEqual(Array.from(mesh.getMatrixAt(1).elements), Array.from(t.elements));
  mesh.setTRSAt(2, 1, 2, 3, Math.PI / 2, 2);
  const trs = mesh.getMatrixAt(2).elements;
  assert.ok(Math.abs(trs[12]! - 1) < 1e-6 && Math.abs(trs[13]! - 2) < 1e-6 && Math.abs(trs[14]! - 3) < 1e-6);
  assert.ok(Math.abs(trs[5]! - 2) < 1e-6, "缩放");

  mesh.instanceCount = 2;
  assert.equal(mesh.instanceCount, 2);
  mesh.instanceCount = 99;
  assert.equal(mesh.instanceCount, 3, "clamp 到 capacity");
  mesh.instanceCount = -5;
  assert.equal(mesh.instanceCount, 0);

  let threw = false;
  try {
    mesh.setMatrixAt(3, t);
  } catch (e) {
    threw = e instanceof Error && /超出容量/.test(e.message);
  }
  assert.ok(threw, "超出容量的实例序号应报错");
});

test("InstancedMesh：脏区间批量上传 + 实例包围球", () => {
  const device = createMockDevice();
  const { mesh } = makeInstanced(device, 4);
  assert.equal(mesh.hasPendingUpload, true, "构造后需要首次上传");
  mesh.upload();
  assert.equal(mesh.hasPendingUpload, false);
  mesh.setMatrixAt(2, Mat4.identity().translate(100, 0, 0));
  assert.equal(mesh.hasPendingUpload, true, "改动后重新标记待上传");
  mesh.upload();
  assert.equal(mesh.hasPendingUpload, false);

  // 包围球覆盖所有实例（x 从 0 到 100）
  mesh.updateWorldBounds(true);
  assert.ok(mesh.worldRadius > 40, `联合包围球应覆盖远处实例（实际 ${mesh.worldRadius}）`);
  assert.ok(mesh.worldCenter.x > 20, "中心随实例分布右移");
});

test("SceneRenderer：InstancedMesh 一次绘制 + 顶点流 slot 1", () => {
  const device = createMockDevice();
  const { mesh, material } = makeInstanced(device, 5);
  const scene = new Scene();
  scene.add(mesh);
  const camera = new Camera();
  camera.distance = 20;
  camera.pitch = 0.3;
  camera.update();
  const sceneRenderer = new SceneRenderer();

  const encoder = device.createCommandEncoder("i");
  const pass = encoder.beginRenderPass({
    colorAttachments: [{ view: null, loadOp: "clear", storeOp: "store" }],
    depthStencilAttachment: null,
  });
  sceneRenderer.render(pass, scene, camera);
  pass.end();
  device.submit([encoder.finish()]);

  const calls = device.drawCalls;
  assert.equal(calls.length, 1, "5 个实例只产生 1 次 draw");
  assert.equal(calls[0]!.draw.instanceCount, 5);
  assert.equal(calls[0]!.draw.indexCount, mesh.geometry.indexCount);
  const slots = calls[0]!.vertexBuffers.map((v) => v.slot).sort();
  assert.deepEqual(slots, [0, INSTANCE_VERTEX_SLOT], "标准顶点流 + 实例矩阵流");
  assert.equal(calls[0]!.vertexBuffers.find((v) => v.slot === INSTANCE_VERTEX_SLOT)!.buffer, mesh.instanceBuffer);
  assert.equal(sceneRenderer.stats.drawn, 1);
  assert.equal(sceneRenderer.stats.triangles, (mesh.geometry.indexCount / 3) * 5, "三角形数按实例数放大");
  assert.ok(material.pipelineHandle);
});

test("SceneRenderer：材质不支持实例化时退化（自定义顶点着色器）", () => {
  const device = createMockDevice();
  const { mesh } = makeInstanced(device, 3);
  // 自定义材质：只有 drawGeometry，没有 drawInstanced
  const draws: Mat4[] = [];
  const custom: MaterialLike = {
    beginFrame() {},
    drawGeometry(_pass: RenderPassEncoder, _g: GeometryType, model: Mat4) {
      draws.push(model.clone());
    },
  };
  mesh.material = custom;
  const scene = new Scene();
  scene.add(mesh);
  const camera = new Camera();
  camera.distance = 20;
  camera.pitch = 0.3;
  camera.update();
  const sceneRenderer = new SceneRenderer();
  const encoder = device.createCommandEncoder("f");
  const pass = encoder.beginRenderPass({
    colorAttachments: [{ view: null, loadOp: "clear", storeOp: "store" }],
    depthStencilAttachment: null,
  });
  sceneRenderer.render(pass, scene, camera);
  pass.end();
  device.submit([encoder.finish()]);

  assert.equal(draws.length, 3, "退化成 3 次普通绘制");
  assert.ok(Math.abs(draws[1]!.elements[12]! - 2) < 1e-6, "第 2 个实例 x = 2（world × instance）");
  assert.ok(Math.abs(draws[2]!.elements[12]! - 4) < 1e-6);
  assert.equal(sceneRenderer.stats.drawn, 3);
});

test("Mat4 乘序：world × instance 复合平移正确", () => {
  const world = Mat4.identity().translate(10, 0, 0);
  const instance = Mat4.identity().translate(1, 2, 3);
  const out = Mat4.multiply(world, instance);
  assert.deepEqual([out.elements[12], out.elements[13], out.elements[14]], [11, 2, 3]);
});
