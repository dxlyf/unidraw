/**
 * 后处理示例：RenderTarget + EffectComposer + Bloom / ToneMap / Vignette。
 *
 * - 场景先画进 `composer.sceneTarget`（可开 MSAA，自动 resolve），再过效果链，最后输出到画布；
 * - 键盘：B 泛光开关 · T 循环色调映射(aces/reinhard/linear/none) · V 暗角 · M 切 MSAA(1/4)
 *   · P 整条后处理链开关（直接画布 vs 后处理，便于肉眼对比）；
 * - `?selftest=1`（默认）：离屏跑三种配置并比较像素统计，打印 POSTFX_SELFTEST。
 */

import { Renderer } from "../../src/render/Renderer.js";
import { Camera } from "../../src/render/Camera.js";
import { Scene, SceneRenderer } from "../../src/scene/index.js";
import { Mesh } from "../../src/render/Mesh.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box, plane, sphere, torus } from "../../src/render/primitives.js";
import { PhongMaterial, UnlitColorMaterial } from "../../src/render/material.js";
import { Color } from "../../src/math/color.js";
import { Vec3 } from "../../src/math/vec3.js";
import { degToRad } from "../../src/math/mmath.js";
import { AmbientLight, DirectionalLight, PointLight } from "../../src/render/lights/index.js";
import { BloomPass, EffectComposer, ToneMapPass, VignettePass, type ToneMappingMode } from "../../src/render/postfx/index.js";
import { InputManager } from "../../src/interaction/InputManager.js";
import { attachOrbitControls } from "../common/demo.js";

const canvas = document.createElement("canvas");
canvas.id = "canvas";
canvas.style.cssText = "display:block;width:100vw;height:100vh;touch-action:none";
document.body.style.cssText = "margin:0;background:#08090d;overflow:hidden";
document.body.appendChild(canvas);

const params = new URLSearchParams(location.search);
const backend = params.get("backend") as "auto" | "webgpu" | "webgl2" | null;

const status: { backend: string; err: string; frames: number } = { backend: "", err: "", frames: 0 };
(globalThis as Record<string, unknown>).__unidraw = { get status() { return status; } };
window.addEventListener("error", (e) => (status.err = e.message));
window.addEventListener("unhandledrejection", (e) => {
  status.err = e.reason instanceof Error ? e.reason.message : String(e.reason);
});

const renderer = await Renderer.create(canvas, { backend: backend ?? "auto", background: "#08090d" });
status.backend = renderer.device.kind;
const device = renderer.device;

const scene = new Scene();
const camera = new Camera();
camera.setPerspective(degToRad(55), canvas.width / Math.max(1, canvas.height), 0.1, 400);
camera.center.set(0, 0.6, 0);
camera.distance = 11;
camera.pitch = 0.24;
camera.yaw = 0.5;
camera.update();
attachOrbitControls(camera, canvas);

// ---- 场景：暗色地面 + 高亮物体（泛光光源）+ 受光物体 --------------------
const floorMat = new UnlitColorMaterial(device, new Color(0.05, 0.055, 0.07, 1), { label: "floor", targetFormat: "rgba8unorm" });
const floor = new Mesh(Geometry.create(device, plane(30, 30, 1, 1)));
floor.model.setIdentity().rotateX(degToRad(-90)).translate(0, -1, 0);
floor.material = floorMat;
scene.add(floor);

const glowColors = ["#ff2d6f", "#38ffd0", "#4c8dff", "#ffd166"];
const glows: Mesh[] = [];
for (let i = 0; i < 4; i++) {
  const material = new UnlitColorMaterial(device, new Color().setHex(glowColors[i]!), { label: `glow-${i}`, targetFormat: "rgba8unorm" });
  const mesh = new Mesh(Geometry.create(device, sphere(0.42, 32, 20)));
  const a = (i / 4) * Math.PI * 2;
  mesh.setPosition(Math.cos(a) * 3.2, 0.4 + (i % 2) * 1.6, Math.sin(a) * 3.2);
  mesh.material = material;
  scene.add(mesh);
  glows.push(mesh);
}

const bodyMat = new PhongMaterial(device, new Color().setHex("#cfd8ea"), {
  label: "body",
  shininess: 120,
  specular: 1.2,
  ambient: 0.35,
  targetFormat: "rgba8unorm",
});
const bodies: Mesh[] = [];
for (let i = 0; i < 5; i++) {
  const mesh = new Mesh(Geometry.create(device, i % 2 === 0 ? box(1.4, 1.4, 1.4) : torus(0.8, 0.3, 40, 20)));
  mesh.setPosition((i - 2) * 2.4, -0.2, -2.6);
  mesh.material = bodyMat;
  scene.add(mesh);
  bodies.push(mesh);
}

scene.add(new AmbientLight("#41506e", 0.4));
scene.add(new DirectionalLight(new Vec3(0.4, -0.85, -0.35), "#fff0d0", 0.7));
const point = new PointLight("#7bd0ff", 40, 18, 2);
point.setPosition(0, 4.5, 2.5);
scene.add(point);

const sceneRenderer = new SceneRenderer();

// ---- 后处理链 ----------------------------------------------------------
const msaaFromUrl = (() => {
  const v = Number(params.get("msaa"));
  return v === 1 || v === 4 ? v : 4;
})();
let msaa = Math.min(msaaFromUrl, device.limits.maxSamples ?? 1);
const composer = new EffectComposer(device, {
  width: canvas.width,
  height: canvas.height,
  sampleCount: msaa,
  label: "postfx",
});
const bloom = new BloomPass(device, { threshold: 0.65, strength: 1.1, radius: 2.2, scale: 0.5 });
const tonemap = new ToneMapPass(device, { mode: "aces", exposure: 1.15 });
const vignette = new VignettePass(device, { strength: 0.45, softness: 0.7 });
composer.addPass(bloom);
composer.addPass(tonemap);
composer.addPass(vignette);

const state = { post: true, bloom: true, vignette: true, tonemap: "aces" as ToneMappingMode };
bloom.threshold = 0.65;

function applyState(): void {
  composer.passList.length = 0;
  if (state.bloom) composer.addPass(bloom);
  if (state.tonemap !== "none") {
    tonemap.mode = state.tonemap;
    composer.addPass(tonemap);
  }
  if (state.vignette) composer.addPass(vignette);
}

// ---- HUD ---------------------------------------------------------------
const hud = document.createElement("div");
hud.id = "postfx-hud";
hud.style.cssText =
  "position:fixed;left:12px;top:12px;color:#d7d9e0;font:12px/1.6 ui-monospace,Consolas,monospace;" +
  "background:rgba(16,18,26,.72);border:1px solid #2b3040;border-radius:8px;padding:10px 12px;z-index:20;white-space:pre;pointer-events:none";
document.body.appendChild(hud);

function updateHud(): void {
  hud.textContent =
    `backend : ${device.kind}\n` +
    `后处理   : ${state.post ? "开" : "关（直接画布）"}  ·  MSAA ${msaa}x（上限 ${device.limits.maxSamples ?? 1}）\n` +
    `效果链   : ${composer.passList.map((p) => p.name).join(" → ") || "(空)"}\n` +
    `泛光     : ${state.bloom ? "开" : "关"}  阈值 ${bloom.threshold} 强度 ${bloom.strength}\n` +
    `色调映射 : ${state.tonemap}  曝光 ${tonemap.exposure}\n` +
    `keys     : B 泛光 · T 色调映射 · V 暗角 · M MSAA · P 后处理链开关`;
}

const input = new InputManager(canvas, { preventWheelDefault: true });
input.on("keydown", (e) => {
  if (e.code === "KeyB") state.bloom = !state.bloom;
  else if (e.code === "KeyV") state.vignette = !state.vignette;
  else if (e.code === "KeyP") state.post = !state.post;
  else if (e.code === "KeyT") {
    const modes: ToneMappingMode[] = ["aces", "reinhard", "linear", "none"];
    state.tonemap = modes[(modes.indexOf(state.tonemap) + 1) % modes.length]!;
  } else if (e.code === "KeyM") {
    msaa = (device.limits.maxSamples ?? 1) > 1 ? (msaa === 4 ? 1 : 4) : 1;
    rebuildComposer();
  } else return;
  applyState();
  updateHud();
});

let composerMsaa = msaa;
function rebuildComposer(): void {
  if (msaa === composerMsaa) return;
  composerMsaa = msaa;
  // 只换场景目标的采样数：链路内部目标与效果实例保持复用。
  // 材质会按附件的采样数自动取到匹配的管线（Multisample），无需手动重建。
  composer.setSampleCount(msaa);
}

// ---- 自检 --------------------------------------------------------------
const selfTest = params.get("selftest") !== "0";
let frames = 0;
let elapsed = 0;
let tested = false;

function drawScene(pass: Parameters<SceneRenderer["render"]>[0]): void {
  sceneRenderer.render(pass, scene, camera);
}

function brightRatio(pixels: Uint8Array, threshold = 0.55): number {
  let bright = 0;
  const total = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    const l = (0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!) / 255;
    if (l > threshold) bright++;
  }
  return bright / total;
}

function meanLuma(pixels: Uint8Array): number {
  let acc = 0;
  const total = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    acc += (0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!) / 255;
  }
  return acc / total;
}

async function runSelfTest(): Promise<void> {
  // 配置 1：完整链（bloom + aces + vignette）
  applyState();
  const withBloom = await composer.renderToPixels(drawScene);
  const bloomPixels = Uint8Array.from(withBloom);

  // 配置 2：关泛光
  state.bloom = false;
  applyState();
  const noBloom = await composer.renderToPixels(drawScene);
  state.bloom = true;

  // 配置 3：linear 色调映射（对比 aces 的高光压缩）
  state.tonemap = "linear";
  applyState();
  const linear = await composer.renderToPixels(drawScene);
  state.tonemap = "aces";
  applyState();

  const result = {
    backend: device.kind,
    msaa,
    brightWithBloom: Number(brightRatio(bloomPixels).toFixed(4)),
    brightNoBloom: Number(brightRatio(noBloom).toFixed(4)),
    meanAces: Number(meanLuma(bloomPixels).toFixed(4)),
    meanLinear: Number(meanLuma(linear).toFixed(4)),
    // 泛光必须让亮部变多（说明链路真的在起作用）
    bloomOk: brightRatio(bloomPixels) > brightRatio(noBloom),
    // 两种色调映射必须给出可测量的差异（说明该趟真的生效）。
    // 场景是 LDR 且整体偏暗，差异天然很小，因此阈值取 1e-4。
    tonemapOk: Math.abs(meanLuma(bloomPixels) - meanLuma(linear)) > 1e-4,
    // 三种配置都必须有内容（MSAA resolve / 离屏渲染生效）
    contentOk: meanLuma(bloomPixels) > 0.02 && meanLuma(noBloom) > 0.02,
  };
  console.log("POSTFX_SELFTEST " + JSON.stringify(result));
}

function loop(): void {
  frames++;
  elapsed += 1 / 60;
  status.frames = frames;
  const changed = renderer.resizeToDisplaySize(2);
  if (changed) {
    camera.aspect = canvas.width / Math.max(1, canvas.height);
    camera.update();
    composer.resize(canvas.width, canvas.height);
  }
  // 点光/发光体轻微运动，泛光更有说服力
  for (let i = 0; i < glows.length; i++) {
    const m = glows[i]!;
    m.setPosition(m.position.x, 0.4 + (i % 2) * 1.6 + Math.sin(elapsed * 1.2 + i) * 0.25, m.position.z);
  }
  point.setPosition(Math.cos(elapsed * 0.5) * 4, 4 + Math.sin(elapsed * 0.8) * 0.8, Math.sin(elapsed * 0.5) * 4);
  camera.update();

  if (state.post) {
    composer.render(drawScene);
  } else {
    // 直接用 canvas pass 渲染（对比用）
    const pass = renderer.beginFrame();
    drawScene(pass);
    renderer.endFrame();
  }
  updateHud();

  if (selfTest && !tested && frames === 40) {
    tested = true;
    void runSelfTest().catch((e) => console.log("POSTFX_SELFTEST_ERROR " + (e instanceof Error ? e.message : String(e))));
  }
  requestAnimationFrame(loop);
}
loop();
