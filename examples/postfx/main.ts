/**
 * 后处理示例：RenderTarget + EffectComposer + Bloom / ToneMap / Vignette。
 *
 * - 场景先画进 `composer.sceneTarget`（可开 MSAA，自动 resolve），再过效果链，最后输出到画布；
 * - 右上角 lil-gui 面板可实时改所有参数（`?gui=0` 关面板）：后处理链 / 泛光（阈值、强度、
 *   半径、中间层比例）/ 色调映射（模式、曝光）/ 暗角（强度、柔化）/ MSAA；
 * - 键盘：B 泛光开关 · T 循环色调映射(aces/reinhard/linear/none) · V 暗角 · M 切 MSAA(1/4)
 *   · P 整条后处理链开关（直接画布 vs 后处理，便于肉眼对比）—— 快捷键是面板的等价别名；
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
import { addButtons, applyUrlOverrides, createGui } from "../common/gui.js";

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

// ---- 后处理链（参数集中在 state：URL 给初值，面板/键盘实时改） ----------
const msaaFromUrl = (() => {
  const v = Number(params.get("msaa"));
  return v === 1 || v === 4 ? v : 4;
})();
const state = {
  /** 整条后处理链开关（关掉 = 直接画到画布，便于肉眼对比） */
  post: true,
  bloom: true,
  vignette: true,
  tonemap: "aces" as ToneMappingMode,
  /** 泛光亮度阈值 */
  threshold: 0.65,
  /** 泛光叠加强度 */
  strength: 1.1,
  /** 泛光模糊半径（像素） */
  radius: 2.2,
  /** 泛光中间层分辨率比例。进的是 RenderTarget 尺寸 → 不可热改，改它要重建 BloomPass */
  bloomScale: 0.5,
  exposure: 1.15,
  vignetteStrength: 0.45,
  vignetteSoftness: 0.7,
  msaa: msaaFromUrl,
};
applyUrlOverrides(state, params);

const normalizeMsaa = (v: number): number => (v === 1 || v === 4 ? v : 4);
let msaa = Math.min(normalizeMsaa(state.msaa), device.limits.maxSamples ?? 1);
state.msaa = msaa;

const composer = new EffectComposer(device, {
  width: canvas.width,
  height: canvas.height,
  sampleCount: msaa,
  label: "postfx",
});
/** `scale` 在构造时就决定了中间层 RenderTarget 的尺寸，无法热改 → 换比例时整个 pass 重建 */
function createBloom(): BloomPass {
  return new BloomPass(device, {
    threshold: state.threshold,
    strength: state.strength,
    radius: state.radius,
    scale: state.bloomScale,
  });
}
let bloom = createBloom();
const tonemap = new ToneMapPass(device, { mode: "aces", exposure: state.exposure });
const vignette = new VignettePass(device, { strength: state.vignetteStrength, softness: state.vignetteSoftness });

function applyBloomParams(): void {
  bloom.threshold = state.threshold;
  bloom.strength = state.strength;
  bloom.radius = state.radius;
}

function applyTonemapParams(): void {
  tonemap.exposure = state.exposure;
}

function applyVignetteParams(): void {
  vignette.strength = state.vignetteStrength;
  vignette.softness = state.vignetteSoftness;
}

function applyState(): void {
  composer.passList.length = 0;
  if (state.bloom) composer.addPass(bloom);
  if (state.tonemap !== "none") {
    tonemap.mode = state.tonemap;
    composer.addPass(tonemap);
  }
  if (state.vignette) composer.addPass(vignette);
}
applyState();
applyBloomParams();
applyTonemapParams();
applyVignetteParams();

let composerMsaa = msaa;
function rebuildComposer(): void {
  if (msaa === composerMsaa) return;
  composerMsaa = msaa;
  // 只换场景目标的采样数：链路内部目标与效果实例保持复用。
  // 材质会按附件的采样数自动取到匹配的管线（Multisample），无需手动重建。
  composer.setSampleCount(msaa);
}

/** 面板/键盘改 MSAA：非 1/4 或设备上限更低时按上限收敛，回写 state 让面板显示真实值 */
function applyMsaa(): void {
  state.msaa = Math.min(normalizeMsaa(state.msaa), device.limits.maxSamples ?? 1);
  msaa = state.msaa;
  rebuildComposer();
}

/** 中间层比例变了 → 新建 BloomPass（内部目标尺寸随 scale）并替换进链里 */
function rebuildBloom(): void {
  const next = createBloom();
  bloom.dispose();
  bloom = next;
  applyState();
  syncControllers();
}

/** 重建后把面板里的数值刷新成真实状态（键盘/按钮/自检回写都走这里） */
function syncControllers(): void {
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
}

// ---- 参数面板（lil-gui） -----------------------------------------------
const gui = createGui({ title: "后处理（PostFX）", params });
gui.add(state, "post").name("后处理链").onChange(applyState);
gui
  .add(state, "msaa", { "1x（关 MSAA）": 1, "4x": 4 })
  .name("MSAA")
  .onChange(() => {
    applyMsaa();
    syncControllers();
  });
gui.add(state, "bloom").name("泛光开关").onChange(applyState);
const bloomFolder = gui.addFolder("泛光 Bloom");
bloomFolder.add(state, "threshold", 0, 1.5, 0.01).name("阈值").onChange(applyBloomParams);
bloomFolder.add(state, "strength", 0, 3, 0.01).name("强度").onChange(applyBloomParams);
bloomFolder.add(state, "radius", 0, 6, 0.05).name("半径（像素）").onChange(applyBloomParams);
bloomFolder
  .add(state, "bloomScale", { "1/4": 0.25, "1/2": 0.5, "3/4": 0.75, "1/1": 1 })
  .name("中间层比例（重建）")
  .onChange(rebuildBloom);
const tonemapFolder = gui.addFolder("色调映射 ToneMap");
tonemapFolder
  .add(state, "tonemap", { ACES: "aces", Reinhard: "reinhard", 线性: "linear", 关闭: "none" })
  .name("模式")
  .onChange(applyState);
tonemapFolder.add(state, "exposure", 0, 3, 0.01).name("曝光").onChange(applyTonemapParams);
const vignetteFolder = gui.addFolder("暗角 Vignette");
vignetteFolder.add(state, "vignette").name("开关").onChange(applyState);
vignetteFolder.add(state, "vignetteStrength", 0, 1, 0.01).name("强度").onChange(applyVignetteParams);
vignetteFolder.add(state, "vignetteSoftness", 0, 1, 0.01).name("柔化").onChange(applyVignetteParams);
vignetteFolder.close();
addButtons(gui, "操作", {
  重置默认: () => {
    state.post = true;
    state.bloom = true;
    state.vignette = true;
    state.tonemap = "aces";
    state.threshold = 0.65;
    state.strength = 1.1;
    state.radius = 2.2;
    state.bloomScale = 0.5;
    state.exposure = 1.15;
    state.vignetteStrength = 0.45;
    state.vignetteSoftness = 0.7;
    state.msaa = 4;
    rebuildBloom();
    applyMsaa();
    applyTonemapParams();
    applyVignetteParams();
    applyState();
    syncControllers();
  },
});

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
    `面板      : 右上角 lil-gui 可调（?gui=0 关闭）`;
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
    state.msaa = msaa === 4 ? 1 : 4;
    applyMsaa();
  } else return;
  applyState();
  // 快捷键与面板是同一份 state：改完把面板显示同步过来
  syncControllers();
  updateHud();
});

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
