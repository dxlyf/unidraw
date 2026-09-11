/**
 * 混合模式与材质选项测试：
 * - `MaterialOptions.blend` / `depthWrite` 是否真的进到管线描述里；
 * - `isTransparent` 的判定（`alphaBlend` 或 `blend`）；
 * - `BLEND_PRESETS` 预设的完整性与回退；
 * - `SceneRenderer` 的半透明排序：不透明先画、半透明按距离**远→近**。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockDevice } from "../device/createDevice.js";
import type { MockDevice } from "../device/backend/mock/MockDevice.js";
import { ColorMaterial } from "../render/material.js";
import { ALPHA_BLEND, BLEND_PRESETS, blendPreset, blendState } from "../render/blendModes.js";
import { Color } from "../math/color.js";
import { Mesh } from "../render/Mesh.js";
import { Geometry } from "../render/Geometry.js";
import { box } from "../render/primitives.js";
import { Scene } from "../scene/Scene.js";
import { SceneRenderer } from "../scene/SceneRenderer.js";
import { Camera } from "../render/Camera.js";

test("BLEND_PRESETS：预设完整、可查、可回退", () => {
  assert.ok(BLEND_PRESETS.length >= 6);
  const ids = new Set<string>();
  for (const preset of BLEND_PRESETS) {
    assert.ok(preset.id.length > 0 && preset.label.length > 0);
    assert.ok(!ids.has(preset.id), `预设 id 重复：${preset.id}`);
    ids.add(preset.id);
    if (preset.state) {
      for (const component of [preset.state.color, preset.state.alpha]) {
        assert.ok(typeof component.srcFactor === "string" && typeof component.dstFactor === "string");
        assert.ok(typeof component.operation === "string");
      }
    }
  }
  assert.equal(blendPreset("additive").id, "additive");
  assert.equal(blendPreset("不存在的 id").id, BLEND_PRESETS[0]!.id, "未知 id 回退到第一个");
  assert.deepEqual(ALPHA_BLEND, blendPreset("normal").state);
  // 自定义因子/运算
  const custom = blendState({ src: "one", dst: "one-minus-src", op: "add" }, { src: "zero", dst: "one" });
  assert.equal(custom.color.srcFactor, "one");
  assert.equal(custom.alpha.srcFactor, "zero");
});

test("材质选项：blend / depthWrite / isTransparent 落到管线描述", () => {
  const device: MockDevice = createMockDevice();
  const opaque = new ColorMaterial(device, new Color(1, 1, 1, 1), { label: "opaque" });
  assert.equal(opaque.isTransparent, false);
  assert.equal(opaque.pipelineHandle.descriptor.targets[0]!.blend, undefined, "默认不混合");
  assert.equal(opaque.pipelineHandle.descriptor.depthStencil?.depthWriteEnabled, true);

  const alpha = new ColorMaterial(device, new Color(1, 1, 1, 0.5), { label: "alpha", alphaBlend: true });
  assert.equal(alpha.isTransparent, true);
  assert.deepEqual(alpha.pipelineHandle.descriptor.targets[0]!.blend, ALPHA_BLEND, "alphaBlend = 标准混合");

  const additive = new ColorMaterial(device, new Color(1, 1, 1, 1), {
    label: "additive",
    blend: blendPreset("additive").state,
    depthWrite: false,
  });
  assert.equal(additive.isTransparent, true, "自定义 blend 也算半透明");
  const blend = additive.pipelineHandle.descriptor.targets[0]!.blend!;
  assert.equal(blend.color.srcFactor, "src-alpha");
  assert.equal(blend.color.dstFactor, "one");
  assert.equal(additive.pipelineHandle.descriptor.depthStencil?.depthWriteEnabled, false, "depthWrite: false 生效但仍有深度测试");
  assert.equal(additive.pipelineHandle.descriptor.depthStencil?.depthCompare, "less-equal");

  // 换成不透明因子后不再是半透明
  const replacing = new ColorMaterial(device, new Color(1, 1, 1, 1), {
    label: "replace",
    blend: blendState({ src: "one", dst: "zero" }, { src: "one", dst: "zero" }),
  });
  assert.equal(replacing.isTransparent, true, "只要声明了 blend 就算半透明（排序更安全）");
  assert.equal(replacing.pipelineHandle.descriptor.targets[0]!.blend!.color.dstFactor, "zero");
});

test("SceneRenderer：不透明先画，半透明按距离远→近", () => {
  const device = createMockDevice();
  const scene = new Scene();
  const opaqueMat = new ColorMaterial(device, new Color(1, 1, 1, 1), { label: "opaque" });
  const transMat = new ColorMaterial(device, new Color(1, 1, 1, 0.4), { label: "transparent", alphaBlend: true });
  const geometry = Geometry.create(device, box(1, 1, 1));

  // 相机在 +Z 方向：z 越大越近
  const near = new Mesh(geometry, transMat);
  near.setPosition(0, 0, 4);
  const far = new Mesh(geometry, transMat);
  far.setPosition(0, 0, -4);
  const solid = new Mesh(geometry, opaqueMat);
  solid.setPosition(0, 0, 0);
  // 故意按「近→远」顺序加入场景，验证排序会把它们翻过来
  scene.add(near);
  scene.add(far);
  scene.add(solid);

  const camera = new Camera();
  camera.distance = 12;
  camera.yaw = 0;
  camera.pitch = 0;
  camera.update();
  const sceneRenderer = new SceneRenderer();

  const encoder = device.createCommandEncoder("blend-sort");
  const pass = encoder.beginRenderPass({
    colorAttachments: [{ view: null, loadOp: "clear", storeOp: "store" }],
    depthStencilAttachment: null,
  });
  const visible = sceneRenderer.collectVisible(scene, camera);
  sceneRenderer.render(pass, scene, camera);
  pass.end();
  device.submit([encoder.finish()]);

  // 可见列表顺序 = 实际绘制顺序
  assert.equal(visible.length, 3);
  assert.equal(visible[0], solid, "不透明物体先画");
  assert.equal(visible[1], far, "半透明里更远的先画");
  assert.equal(visible[2], near, "半透明里更近的后画");

  // 关掉排序后恢复场景顺序（近→远），这正是「半透明要排序」的原因
  sceneRenderer.sort = false;
  const unsorted = sceneRenderer.collectVisible(scene, camera);
  assert.deepEqual(Array.from(unsorted), [near, far, solid]);
});
