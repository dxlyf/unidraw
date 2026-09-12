/**
 * StandardMaterial（metallic-roughness PBR）单元测试：默认值与 clamp、
 * 可创建并绘制、贴图槽（binding 4/5）、阴影接入与实例化管线。
 *
 * 参考 `shapes3d-materials.test.ts` 的写法（Mock 后端只记录 draw 与资源描述，
 * 因此断言的是「管线/绑定/UBO 内容对不对」而不是像素结果）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockDevice } from "../device/createDevice.js";
import type { MockDevice } from "../device/backend/mock/MockDevice.js";
import type { MockBuffer } from "../device/backend/mock/resources/MockBuffer.js";
import { TextureUsage } from "../gpu/types.js";
import { Color } from "../math/color.js";
import { Mat4 } from "../math/mat4.js";
import { Vec3 } from "../math/vec3.js";
import { Camera } from "../render/Camera.js";
import { Geometry } from "../render/Geometry.js";
import { InstancedMesh } from "../render/InstancedMesh.js";
import { Mesh } from "../render/Mesh.js";
import { StandardMaterial } from "../render/material.js";
import { INSTANCE_VERTEX_SLOT } from "../render/materialCommon.js";
import { box } from "../render/primitives.js";
import { Scene } from "../scene/Scene.js";
import { SceneRenderer } from "../scene/SceneRenderer.js";
import { DirectionalLight } from "../render/lights/index.js";
import {
  MAX_SHADOW_MAPS,
  SHADOW_BLOCK_BINDING,
  SHADOW_SAMPLER_BINDING,
  SHADOW_TEXTURE_BINDING,
} from "../render/shadow/index.js";

function makeTexture(device: MockDevice, rgba: [number, number, number, number]) {
  const texture = device.createTexture({
    width: 1,
    height: 1,
    format: "rgba8unorm",
    usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST,
  });
  texture.upload(new Uint8Array(rgba));
  return texture;
}

/** 读回某个 UBO binding 的内容（Mock 后端保留了 CPU 字节） */
function uboFloats(material: StandardMaterial, binding: number): Float32Array {
  const entry = material.bindGroupResource.descriptor.entries.find((e) => e.binding === binding);
  assert.ok(entry, `bind group 应包含 binding ${binding}`);
  const buffer = entry.resource as MockBuffer;
  return new Float32Array(buffer.data.buffer, buffer.data.byteOffset, buffer.data.byteLength / 4);
}

function drawOnce(device: MockDevice, material: StandardMaterial): void {
  const camera = new Camera();
  camera.distance = 5;
  camera.aspect = 1;
  camera.update();
  const mesh = new Mesh(Geometry.create(device, box(1, 1, 1)));
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view: null, loadOp: "clear", storeOp: "store" }] });
  material.beginFrame(camera.viewProjection, camera.eyePosition);
  material.draw(pass, mesh);
  pass.end();
  device.submit([encoder.finish()]);
}

test("StandardMaterial：默认值与 clamp（含构造风格与 UBO 写入）", () => {
  const device = createMockDevice();
  const mat = new StandardMaterial(device, { label: "pbr-default" });
  assert.equal(mat.roughness, 1, "默认粗糙度 1");
  assert.equal(mat.metalness, 0, "默认金属度 0");
  assert.ok(mat.color.equals(new Color(1, 1, 1, 1), 1e-6), "默认基础色为白");
  assert.ok(mat.emissive.equals(new Color(0, 0, 0, 1), 1e-6), "默认自发光为黑");
  assert.equal(mat.emissiveIntensity, 1);
  assert.equal(mat.normalScale, 1);
  assert.equal(mat.map, null, "默认没有基础色贴图");
  assert.equal(mat.normalMap, null, "默认没有法线贴图");

  // getter/setter 写法：写入时 clamp
  mat.roughness = 2;
  assert.equal(mat.roughness, 1);
  mat.roughness = -1;
  assert.equal(mat.roughness, 0);
  mat.metalness = 5;
  assert.equal(mat.metalness, 1);
  mat.metalness = -0.5;
  assert.equal(mat.metalness, 0);
  mat.normalScale = -3;
  assert.equal(mat.normalScale, 0);

  // 显式 setXxx 写法（与 PhongMaterial 风格一致，返回 this 可链式）
  mat.setRoughness(0.25).setMetalness(0.75).setNormalScale(2).setEmissive("#ff8000").setEmissiveIntensity(3);
  assert.equal(mat.roughness, 0.25);
  assert.equal(mat.metalness, 0.75);
  assert.equal(mat.normalScale, 2);
  assert.equal(mat.emissiveIntensity, 3);
  assert.ok(mat.emissive.equals(new Color().setHex("#ff8000"), 1e-6));

  // 参数确实写进了 UBO（binding 2 = MaterialBlock）
  const params = uboFloats(mat, 2);
  assert.ok(Math.abs(params[4]! - 0.25) < 1e-6, "u_params.x = roughness");
  assert.ok(Math.abs(params[5]! - 0.75) < 1e-6, "u_params.y = metalness");
  assert.ok(Math.abs(params[6]! - 2) < 1e-6, "u_params.z = normalScale");
  const standard = uboFloats(mat, 17);
  assert.ok(Math.abs(standard[0]! - 1) < 1e-6 && Math.abs(standard[1]! - 0.5019608) < 1e-4);
  assert.ok(Math.abs(standard[3]! - 3) < 1e-6, "u_emissive.w = 自发光强度");

  // options 风格构造 + 越界值在构造时就被 clamp
  const viaOptions = new StandardMaterial(device, { color: "#3366ff", roughness: 3, metalness: -2, label: "pbr-opt" });
  assert.ok(viaOptions.color.equals(new Color().setHex("#3366ff"), 1e-6));
  assert.equal(viaOptions.roughness, 1);
  assert.equal(viaOptions.metalness, 0);

  // PhongMaterial 风格构造（颜色作为第 2 个参数）
  const viaColor = new StandardMaterial(device, new Color(0, 1, 0, 1), { label: "pbr-color", roughness: 0.4 });
  assert.ok(viaColor.color.equals(new Color(0, 1, 0, 1), 1e-6));
  assert.equal(viaColor.roughness, 0.4);

  device.destroy();
});

test("StandardMaterial：可创建并绘制，管线与混合状态可用", () => {
  const device = createMockDevice();
  const mat = new StandardMaterial(device, {
    label: "pbr",
    color: "#ffaa33",
    roughness: 0.35,
    metalness: 0.9,
    emissive: "#101010",
    emissiveIntensity: 0.5,
  });
  assert.ok(mat.pipelineHandle, "应创建渲染管线");
  assert.equal(mat.pipelineHandle.descriptor.targets.length, 1);
  drawOnce(device, mat);
  assert.equal(device.drawCalls.length, 1, "应产生一次 draw");
  device.destroy();

  const blendDevice = createMockDevice();
  const blend = new StandardMaterial(blendDevice, { label: "pbr-blend", alphaBlend: true });
  assert.equal(blend.isTransparent, true);
  assert.ok(blend.pipelineHandle.descriptor.targets[0]!.blend, "alphaBlend 应设置混合状态");
  blendDevice.destroy();
});

test("StandardMaterial：map / normalMap 绑定到 layout 的 binding 4/5", () => {
  const device = createMockDevice();
  const mat = new StandardMaterial(device, { label: "pbr-tex" });

  // 未设置贴图时绑定的是 1×1 占位纹理（flags 为 0，着色器不做贴图乘法）
  const initialFlags = uboFloats(mat, 17);
  assert.equal(initialFlags[4], 0);
  assert.equal(initialFlags[5], 0);
  const placeholder = mat.bindGroupResource.descriptor.entries.find((e) => e.binding === 4);
  assert.ok(placeholder, "binding 4 应始终有纹理（占位）");

  const albedo = makeTexture(device, [255, 0, 0, 255]);
  const normal = makeTexture(device, [128, 128, 255, 255]);
  mat.map = albedo;
  mat.normalMap = normal;

  const entries = mat.bindGroupResource.descriptor.entries;
  assert.equal(entries.find((e) => e.binding === 4)?.resource, albedo.view(), "binding 4 = map");
  assert.equal(entries.find((e) => e.binding === 5)?.resource, normal.view(), "binding 5 = normalMap");
  const flags = uboFloats(mat, 17);
  assert.equal(flags[4], 1, "设置 map 后 hasMap = 1");
  assert.equal(flags[5], 1, "设置 normalMap 后 hasNormalMap = 1");

  const layout = mat.layoutEntries;
  assert.equal(layout.find((e) => e.binding === 4)?.name, "u_albedo");
  assert.equal(layout.find((e) => e.binding === 4)?.type, "texture");
  assert.equal(layout.find((e) => e.binding === 5)?.name, "u_normalMap");
  assert.equal(layout.find((e) => e.binding === 5)?.type, "texture");
  assert.ok(
    layout.some((e) => e.binding === 15 && e.type === "sampler") &&
      layout.some((e) => e.binding === 16 && e.type === "sampler"),
    "两张纹理各配一个采样器条目",
  );
  // WebGL2 后端把纹理/采样器按顺序配对：数量必须一致
  assert.equal(
    layout.filter((e) => e.type === "texture").length,
    layout.filter((e) => e.type === "sampler").length,
    "纹理与采样器数量必须一致",
  );

  // 置空后回到占位纹理
  mat.setMap(null);
  assert.equal(uboFloats(mat, 17)[4], 0);
  assert.notEqual(mat.bindGroupResource.descriptor.entries.find((e) => e.binding === 4)?.resource, albedo.view());
  drawOnce(device, mat);
  assert.equal(device.drawCalls.length, 1);
  device.destroy();
});

test("StandardMaterial：receiveShadows / castShadow 接入", () => {
  const device = createMockDevice();
  const lit = new StandardMaterial(device, { label: "pbr-lit" });
  const bindings = lit.bindGroupResource.descriptor.entries.map((e) => e.binding);
  assert.ok(bindings.includes(SHADOW_BLOCK_BINDING), "默认接收阴影：绑定 ShadowBlock");
  for (let i = 0; i < MAX_SHADOW_MAPS; i++) {
    assert.ok(bindings.includes(SHADOW_TEXTURE_BINDING + i), `绑定阴影贴图 ${i}`);
    assert.ok(bindings.includes(SHADOW_SAMPLER_BINDING + i), `绑定阴影采样器 ${i}`);
  }

  const noShadow = new StandardMaterial(device, { label: "pbr-noshadow", receiveShadows: false });
  const noShadowBindings = noShadow.bindGroupResource.descriptor.entries.map((e) => e.binding);
  assert.equal(noShadowBindings.includes(SHADOW_BLOCK_BINDING), false, "receiveShadows:false 不应绑定阴影贴图");

  // 场景里打开 castShadow 的灯光 + StandardMaterial 物体：仍能正常绘制
  const scene = new Scene();
  const sun = new DirectionalLight(new Vec3(-0.5, -1, -0.4), "#ffffff", 1);
  assert.equal(sun.castShadow, false, "默认不投影");
  sun.setShadow({ mapSize: 256 });
  assert.equal(sun.castShadow, true);
  scene.add(sun);
  const mesh = new Mesh(Geometry.create(device, box(1, 1, 1)));
  mesh.material = lit;
  scene.add(mesh);
  const camera = new Camera();
  camera.distance = 6;
  camera.update();
  const encoder = device.createCommandEncoder("standard-shadow");
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view: null, loadOp: "clear", storeOp: "store" }] });
  const renderer = new SceneRenderer();
  renderer.render(pass, scene, camera);
  pass.end();
  device.submit([encoder.finish()]);
  assert.equal(renderer.stats.drawn, 1, "受光物体应被绘制一次");
  assert.equal(device.drawCalls.length, 1);
  device.destroy();
});

test("StandardMaterial：实例化管线可用（一次 draw + 实例矩阵流）", () => {
  const device = createMockDevice();
  const mat = new StandardMaterial(device, { label: "pbr-inst", roughness: 0.5, metalness: 1 });
  const mesh = new InstancedMesh(Geometry.create(device, box(1, 1, 1)), mat, 4);
  for (let i = 0; i < 4; i++) mesh.setPositionAt(i, i * 2, 0, 0);

  const encoder = device.createCommandEncoder("standard-instanced");
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view: null, loadOp: "clear", storeOp: "store" }] });
  mat.beginFrame(new Mat4());
  mat.drawInstanced(pass, mesh.geometry, Mat4.identity(), mesh);
  pass.end();
  device.submit([encoder.finish()]);

  const calls = device.drawCalls;
  assert.equal(calls.length, 1, "4 个实例只产生 1 次 draw");
  assert.equal(calls[0]!.draw.instanceCount, 4);
  assert.equal(calls[0]!.draw.indexCount, mesh.geometry.indexCount);
  assert.deepEqual(
    calls[0]!.vertexBuffers.map((v) => v.slot).sort(),
    [0, INSTANCE_VERTEX_SLOT],
    "标准顶点流 + 实例矩阵流",
  );
  device.destroy();
});
