/**
 * 混合模式示例（blend）：`MaterialOptions.blend` / `depthWrite` / 半透明排序。
 *
 * 场景：一排**互不透明**的实体（地面 + 立柱 + 球）作为背景与遮挡物，
 * 前面叠 3 层半透明平板（不同颜色），用来观察：
 * - 混合因子（src/dst）与运算（add / reverse-subtract / min / max）的效果；
 * - `depthWrite: false` 与 `true` 的差别（不写深度才能看到「后面的半透明」）；
 * - 半透明排序：`SceneRenderer` 把带 `blend`/`alphaBlend` 的材质排在最后、按**远→近**绘制；
 * - `renderOrder` 手动干预顺序（把某一层强制画到最后/最前）。
 *
 * 右上角 lil-gui 面板可以实时改：混合预设、自定义 factor/operation、不透明度、
 * 写深度、深度测试、`renderOrder`、层间距、是否排序。`?gui=0` 关面板（无头回归用）。
 *
 * `?selftest=1`（默认）离屏跑几种配置并比较像素，打印 BLEND_SELFTEST：
 * 叠加必须让亮部变多、正片叠底必须让整体变暗、关掉深度写入后层次必须有变化。
 */

import { Renderer } from "../../src/render/Renderer.js";
import { Camera } from "../../src/render/Camera.js";
import { Scene, SceneRenderer } from "../../src/scene/index.js";
import { Mesh } from "../../src/render/Mesh.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box, plane, sphere } from "../../src/render/primitives.js";
import { ColorMaterial, PhongMaterial, BLEND_PRESETS, blendPreset, blendState } from "../../src/render/material.js";
import { Color } from "../../src/math/color.js";
import { Vec3 } from "../../src/math/vec3.js";
import { degToRad } from "../../src/math/mmath.js";
import { AmbientLight, DirectionalLight, PointLight } from "../../src/render/lights/index.js";
import { RenderTarget } from "../../src/render/RenderTarget.js";
import { InputManager } from "../../src/interaction/InputManager.js";
import { attachOrbitControls } from "../common/demo.js";
import { applyUrlOverrides, createGui } from "../common/gui.js";
import type { BlendFactor, BlendOperation } from "../../src/gpu/types.js";

const canvas = document.createElement("canvas");
canvas.id = "canvas";
canvas.style.cssText = "display:block;width:100vw;height:100vh;touch-action:none";
document.body.style.cssText = "margin:0;background:#07080c;overflow:hidden";
document.body.appendChild(canvas);

const params = new URLSearchParams(location.search);
const backend = params.get("backend") as "auto" | "webgpu" | "webgl2" | null;

const status: { backend: string; err: string; frames: number } = { backend: "", err: "", frames: 0 };
(globalThis as Record<string, unknown>).__unidraw = { get status() { return status; } };
window.addEventListener("error", (e) => (status.err = e.message));
window.addEventListener("unhandledrejection", (e) => {
  status.err = e.reason instanceof Error ? e.reason.message : String(e.reason);
});

const renderer = await Renderer.create(canvas, { backend: backend ?? "auto", background: "#07080c" });
status.backend = renderer.device.kind;
const device = renderer.device;
const canvasFormat = (device.canvasFormat?.() ?? "rgba8unorm") as "rgba8unorm" | "bgra8unorm";

const scene = new Scene();
const camera = new Camera();
camera.setPerspective(degToRad(48), canvas.width / Math.max(1, canvas.height), 0.1, 300);
camera.center.set(0, 1.2, 0);
camera.distance = 13;
camera.pitch = 0.28;
camera.yaw = 0.42;
camera.update();
attachOrbitControls(camera, canvas);

// ---- 背景实体（不透明，用于验证「半透明被正确遮挡 + 叠加在实体上」） ----------
const floor = new Mesh(Geometry.create(device, plane(40, 40, 1, 1)));
floor.model.setIdentity().rotateX(degToRad(-90));
floor.material = new ColorMaterial(device, new Color(0.13, 0.14, 0.17, 1), { label: "floor" });
scene.add(floor);

const solidMat = new PhongMaterial(device, new Color().setHex("#d8dee9"), {
  label: "solid",
  shininess: 64,
  specular: 0.6,
  ambient: 0.35,
});
for (let i = -2; i <= 2; i++) {
  const mesh = new Mesh(Geometry.create(device, i % 2 === 0 ? box(1, 2.4, 1) : box(1, 1.2, 1)));
  mesh.setPosition(i * 2.2, i % 2 === 0 ? 1.2 : 0.6, -1.6);
  mesh.material = solidMat;
  scene.add(mesh);
}
const sphereMesh = new Mesh(Geometry.create(device, sphere(0.9, 32, 20)));
sphereMesh.setPosition(0, 1.4, 1.6);
sphereMesh.material = new PhongMaterial(device, new Color().setHex("#ffb347"), { label: "ball", shininess: 96, specular: 0.8 });
scene.add(sphereMesh);

scene.add(new AmbientLight("#3a4463", 0.55));
scene.add(new DirectionalLight(new Vec3(-0.5, -1, -0.4), "#fff3d6", 0.85));
const glow = new PointLight("#66aaff", 90, 16, 2);
glow.setPosition(-3.5, 3.4, 3.2);
scene.add(glow);

// ---- 半透明层（演示主体） ----------------------------------------------------
const layerColors = ["#ff4d6d", "#38ffd0", "#4c8dff"];
const layers: Mesh[] = [];
const layerMaterials: PhongMaterial[] = [];
for (let i = 0; i < layerColors.length; i++) {
  const material = new PhongMaterial(device, new Color().setHex(layerColors[i]!), {
    label: `layer-${i}`,
    shininess: 24,
    specular: 0.25,
    // 半透明：必须关掉深度写入，否则后面的层会被前面的层挡住
    blend: BLEND_PRESETS[0]!.state,
    depthWrite: false,
    cullMode: "none",
  });
  material.setMaterialParams(24, 0.25, 0.6, 0);
  const mesh = new Mesh(Geometry.create(device, plane(7, 4.2, 1, 1)));
  mesh.setPosition(0, 2, 2 + i * 0.9);
  mesh.material = material;
  scene.add(mesh);
  layers.push(mesh);
  layerMaterials.push(material);
}

const sceneRenderer = new SceneRenderer();

// ---- 参数（URL 可覆盖；GUI 实时改） ------------------------------------------
const state = {
  preset: "normal" as string,
  opacity: 0.55,
  depthWrite: false,
  depthTest: true,
  sorted: true,
  layerGap: 0.9,
  color: "#4c8dff",
  srcFactor: "src-alpha" as BlendFactor,
  dstFactor: "one-minus-src-alpha" as BlendFactor,
  operation: "add" as BlendOperation,
  custom: false,
  renderOrder: 0,
};
applyUrlOverrides(state, params);

function rebuildMaterials(): void {
  const preset = blendPreset(state.preset);
  const blend = state.custom
    ? blendState({ src: state.srcFactor, dst: state.dstFactor, op: state.operation })
    : preset.state;
  for (let i = 0; i < layerMaterials.length; i++) {
    // 材质选项参与管线指纹 → 改混合状态要重建材质（示例里直接新建并替换）
    const next = new PhongMaterial(device, new Color().setHex(state.custom ? state.color : layerColors[i]!), {
      label: `layer-${i}`,
      shininess: 24,
      specular: 0.25,
      blend,
      depthWrite: state.depthWrite && preset.state !== undefined,
      depth: state.depthTest,
      cullMode: "none",
    });
    next.setMaterialParams(24, 0.25, 0.6, 0);
    scene.remove(layers[i]!);
    layerMaterials[i] = next;
    layers[i]!.material = next;
    scene.add(layers[i]!);
  }
  applyLayout();
}

function applyLayout(): void {
  // 注意插入顺序 = 近→远（相机在 +Z 方向）：这样「排序」才有事可做 ——
  // 关掉排序会变成近的先画，半透明叠加顺序就错了
  for (let i = 0; i < layers.length; i++) {
    layers[i]!.setPosition(0, 2, 2 + (layers.length - 1 - i) * state.layerGap);
    layers[i]!.renderOrder = state.renderOrder === 0 ? 0 : i === layers.length - 1 ? state.renderOrder : 0;
    layers[i]!.markDirty();
  }
  sceneRenderer.sort = state.sorted;
}

function applyOpacity(): void {
  for (let i = 0; i < layerMaterials.length; i++) {
    const color = state.custom ? new Color().setHex(state.color) : new Color().setHex(layerColors[i]!);
    color.a = state.opacity;
    layerMaterials[i]!.setColor(color);
  }
}

rebuildMaterials();
applyOpacity();

// ---- GUI -------------------------------------------------------------------
const gui = createGui({ title: "混合模式", params });
gui
  .add(state, "preset", Object.fromEntries(BLEND_PRESETS.map((p) => [p.label, p.id])))
  .name("混合预设")
  .onChange(() => {
    state.custom = false;
    rebuildMaterials();
    applyOpacity();
    syncControllers();
  });
const opacityCtrl = gui.add(state, "opacity", 0, 1, 0.01).name("不透明度").onChange(applyOpacity);
const depthWriteCtrl = gui.add(state, "depthWrite").name("写深度 depthWrite").onChange(rebuildMaterials);
gui.add(state, "depthTest").name("深度测试").onChange(rebuildMaterials);
gui.add(state, "sorted").name("半透明排序").onChange(applyLayout);
gui.add(state, "layerGap", 0.2, 2.5, 0.05).name("层间距").onChange(applyLayout);
gui.add(state, "renderOrder", 0, 10, 1).name("最后一层 renderOrder").onChange(applyLayout);

const customFolder = gui.addFolder("自定义混合（高级）");
const customCtrl = customFolder.add(state, "custom").name("启用自定义").onChange(() => {
  rebuildMaterials();
  applyOpacity();
  syncControllers();
});
const factors = [
  "zero",
  "one",
  "src",
  "one-minus-src",
  "src-alpha",
  "one-minus-src-alpha",
  "dst",
  "one-minus-dst",
  "dst-alpha",
  "one-minus-dst-alpha",
  "src-alpha-saturated",
];
const ops = ["add", "subtract", "reverse-subtract", "min", "max"];
customFolder.add(state, "srcFactor", factors).name("src factor").onChange(rebuildMaterials);
customFolder.add(state, "dstFactor", factors).name("dst factor").onChange(rebuildMaterials);
customFolder.add(state, "operation", ops).name("operation").onChange(rebuildMaterials);
customFolder.addColor(state, "color").name("颜色").onChange(() => {
  rebuildMaterials();
  applyOpacity();
});
customFolder.close();

function syncControllers(): void {
  const interactive = !state.custom && state.preset !== "replace";
  opacityCtrl.enable(interactive);
  depthWriteCtrl.enable(state.preset !== "replace");
  customCtrl.updateDisplay();
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
}
syncControllers();

// ---- HUD（左上角文字统计，与 GUI 分工） -------------------------------------
const hud = document.createElement("div");
hud.id = "blend-hud";
hud.style.cssText =
  "position:fixed;left:12px;top:12px;color:#d7d9e0;font:12px/1.6 ui-monospace,Consolas,monospace;" +
  "background:rgba(16,18,26,.72);border:1px solid #2b3040;border-radius:8px;padding:10px 12px;z-index:20;white-space:pre;pointer-events:none";
document.body.appendChild(hud);

function updateHud(): void {
  const stats = sceneRenderer.stats;
  hud.textContent =
    `backend : ${device.kind}\n` +
    `绘制    : ${stats.drawn} 个物体（半透明 ${layerMaterials.length} 层）\n` +
    `混合    : ${state.custom ? "自定义" : blendPreset(state.preset).label}  不透明度 ${state.opacity.toFixed(2)}\n` +
    `深度    : ${state.depthTest ? "测试开" : "测试关"} / ${state.depthWrite ? "写" : "不写"}\n` +
    `拖拽旋转 · 滚轮缩放 · ?gui=0 关面板`;
}

// 快捷键仍可用（与 GUI 等价，方便键盘党）
const input = new InputManager(canvas, { preventWheelDefault: true });
input.on("keydown", (e) => {
  if (e.code === "Space") {
    const ids = BLEND_PRESETS.map((p) => p.id);
    state.preset = ids[(ids.indexOf(state.preset) + 1) % ids.length]!;
    state.custom = false;
    rebuildMaterials();
    applyOpacity();
    syncControllers();
  } else if (e.code === "KeyD") {
    state.depthWrite = !state.depthWrite;
    rebuildMaterials();
    syncControllers();
  }
});

// ---- 自检 ------------------------------------------------------------------
const selfTest = params.get("selftest") !== "0";
let frames = 0;
let tested = false;
let debugOrder = "";

function luma(pixels: Uint8Array, i: number): number {
  return (0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!) / 255;
}

async function renderOffscreen(): Promise<Uint8Array> {
  const target = new RenderTarget(device, {
    width: canvas.width,
    height: canvas.height,
    format: canvasFormat,
    label: "blend-selftest",
  });
  const encoder = device.createCommandEncoder("blend-selftest");
  const pass = encoder.beginRenderPass({
    label: "blend-selftest-scene",
    colorAttachments: [target.colorAttachment({ clearValue: { r: 0.03, g: 0.031, b: 0.047, a: 1 } })],
    depthStencilAttachment: target.depthAttachment(),
  });
  sceneRenderer.render(pass, scene, camera);
  pass.end();
  device.submit([encoder.finish()]);
  const pixels = await target.readPixels();
  target.dispose();
  return pixels;
}

function meanLuma(pixels: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4) sum += luma(pixels, i);
  return sum / (pixels.length / 4);
}

/** 两层图像的差异（像素级；用于「换混合模式/关深度写入后画面必须变」） */
function diffRatio(a: Uint8Array, b: Uint8Array, threshold = 0.02): number {
  let differing = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(luma(a, i) - luma(b, i)) > threshold) differing++;
  }
  return differing / (a.length / 4);
}

async function runSelfTest(): Promise<void> {
  const before = { preset: state.preset, custom: state.custom, depthWrite: state.depthWrite, opacity: state.opacity, sorted: state.sorted };
  const shoot = async (preset: string, depthWrite: boolean, sorted = true): Promise<Uint8Array> => {
    state.preset = preset;
    state.custom = false;
    state.depthWrite = depthWrite;
    state.sorted = sorted;
    rebuildMaterials();
    applyOpacity();
    debugOrder = collectOrder();
    return renderOffscreen();
  };

  /** 实际绘制顺序（用图层平面在 z 上的位置标记：0=最近层） */
  const collectOrder = (): string =>
    sceneRenderer
      .collectVisible(scene, camera)
      .map((m) => (layers.includes(m) ? `L${layers.indexOf(m)}` : m.geometry === floor.geometry ? "F" : "o"))
      .join("");

  const normal = await shoot("normal", false);
  const additive = await shoot("additive", false);
  const multiply = await shoot("multiply", false);
  const opaque = await shoot("replace", true);
  // 关掉排序：近处层先画，此时「写深度」会让后面的层被挡掉 —— 这正是半透明要
  // 「排序 + 不写深度」的原因，也是这两个开关唯一能看清差别的组合
  const unsorted = await shoot("normal", false, false);
  const unsortedWritten = await shoot("normal", true, false);

  state.preset = before.preset;
  state.custom = before.custom;
  state.depthWrite = before.depthWrite;
  state.opacity = before.opacity;
  state.sorted = before.sorted;
  rebuildMaterials();
  applyOpacity();
  syncControllers();

  const meanNormal = meanLuma(normal);
  const result = {
    backend: device.kind,
    order: debugOrder,
    meanNormal: Number(meanNormal.toFixed(4)),
    meanAdditive: Number(meanLuma(additive).toFixed(4)),
    meanMultiply: Number(meanLuma(multiply).toFixed(4)),
    meanOpaque: Number(meanLuma(opaque).toFixed(4)),
    meanUnsortedWritten: Number(meanLuma(unsortedWritten).toFixed(4)),
    diffAdditive: Number(diffRatio(normal, additive).toFixed(4)),
    diffUnsorted: Number(diffRatio(normal, unsorted).toFixed(4)),
    diffDepthWrite: Number(diffRatio(unsorted, unsortedWritten).toFixed(4)),
    // 叠加让画面更亮、正片叠底让画面更暗
    additiveOk: meanLuma(additive) > meanNormal + 0.002,
    multiplyOk: meanLuma(multiply) < meanNormal - 0.002,
    // 换混合模式 / 开关写深度必须真的改变画面
    blendChanged: diffRatio(normal, additive) > 0.01,
    // 关掉排序必须能看出差别（半透明顺序很重要）
    sortMatters: diffRatio(normal, unsorted) > 0.005,
    // 在「没排序」的前提下，写深度会把后面的层挡掉 → 差别明显
    depthWriteMatters: diffRatio(unsorted, unsortedWritten) > 0.005,
    // 不透明（replace）与混合必须不同
    opaqueDiffers: diffRatio(normal, opaque) > 0.005,
  };
  console.log("BLEND_SELFTEST " + JSON.stringify(result));
}

// ---- 主循环 ---------------------------------------------------------------
function loop(): void {
  frames++;
  status.frames = frames;
  if (renderer.resizeToDisplaySize(2)) {
    camera.aspect = canvas.width / Math.max(1, canvas.height);
    camera.update();
  }
  glow.setPosition(Math.cos(frames * 0.01) * 3.6, 3.4, Math.sin(frames * 0.01) * 3.6);
  camera.update();

  const pass = renderer.beginFrame();
  sceneRenderer.render(pass, scene, camera);
  renderer.endFrame();
  updateHud();

  if (selfTest && !tested && frames === 20) {
    tested = true;
    void runSelfTest().catch((e) => console.log("BLEND_SELFTEST_ERROR " + (e instanceof Error ? e.message : String(e))));
  }
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
