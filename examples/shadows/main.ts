/**
 * 阴影示例（Shadow Map）：方向光 + 聚光投影。
 *
 * - `sun.castShadow = true` → 方向光用**正交拟合**的阴影贴图（自动跟随可见物体包围球，
 *   并按纹素对齐避免抖动）；
 * - `spot.castShadow = true` → 聚光用透视拟合（视场角 = 外锥角）；
 * - 着色器侧手动 3x3 PCF（`texelFetch` / `textureLoad` 读深度自己比），
 *   WebGL2 与 WebGPU 的阴影结果一致，不依赖任何扩展/「比较采样器」；
 * - 阴影 pass **必须与主 pass 分两次提交**（WebGPU 禁止同一 submit 内既写又读同一张纹理），
 *   所以这里用 `shadows.renderAndSubmit(...)`；用 `App` 时设 `shadows: true` 即可自动完成；
 * - 键盘：**S** 阴影开关 · **L** 灯光配置（方向光/聚光/两者）· **R** 转太阳 · **1/2** 贴图 1024/2048；
 * - `?selftest=1`（默认）：离屏渲染「开/关阴影」×「两个太阳方向」四张图，
 *   比较暗像素比例与阴影移动量，打印 SHADOW_SELFTEST（跨后端可直接对比）；
 * - `?debug=1`：把第 0 张阴影贴图的深度可视化为 ASCII 网格（无头调试用）。
 */

import { Renderer } from "../../src/render/Renderer.js";
import { Camera } from "../../src/render/Camera.js";
import { Scene, SceneRenderer } from "../../src/scene/index.js";
import { Mesh } from "../../src/render/Mesh.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box, plane, sphere, torus } from "../../src/render/primitives.js";
import { ColorMaterial } from "../../src/render/material.js";
import { Color } from "../../src/math/color.js";
import { Vec3 } from "../../src/math/vec3.js";
import { degToRad } from "../../src/math/mmath.js";
import { AmbientLight, DirectionalLight, SpotLight } from "../../src/render/lights/index.js";
import { RenderTarget } from "../../src/render/RenderTarget.js";
import { FullScreenPass, POSTFX_COMMON_GLSL } from "../../src/render/postfx/index.js";
import { ShadowRenderer } from "../../src/render/shadow/index.js";
import { InputManager } from "../../src/interaction/InputManager.js";
import { attachOrbitControls } from "../common/demo.js";
import { addButtons, applyUrlOverrides, createGui } from "../common/gui.js";

const canvas = document.createElement("canvas");
canvas.id = "canvas";
canvas.style.cssText = "display:block;width:100vw;height:100vh;touch-action:none";
document.body.style.cssText = "margin:0;background:#0a0c11;overflow:hidden";
document.body.appendChild(canvas);

const params = new URLSearchParams(location.search);
const backend = params.get("backend") as "auto" | "webgpu" | "webgl2" | null;

const status: { backend: string; err: string; frames: number } = { backend: "", err: "", frames: 0 };
(globalThis as Record<string, unknown>).__unidraw = { get status() { return status; } };
window.addEventListener("error", (e) => (status.err = e.message));
window.addEventListener("unhandledrejection", (e) => {
  status.err = e.reason instanceof Error ? e.reason.message : String(e.reason);
});

const renderer = await Renderer.create(canvas, { backend: backend ?? "auto", background: "#0a0c11" });
status.backend = renderer.device.kind;
const device = renderer.device;
const canvasFormat = (device.canvasFormat?.() ?? "rgba8unorm") as "rgba8unorm" | "bgra8unorm";

const scene = new Scene();
const camera = new Camera();
camera.setPerspective(degToRad(50), canvas.width / Math.max(1, canvas.height), 0.1, 400);
camera.center.set(0, 0.6, 0);
camera.distance = 15;
camera.pitch = 0.42;
camera.yaw = 0.7;
camera.update();
attachOrbitControls(camera, canvas);

// ---- 场景：地面（接收阴影）+ 高低不同的物体（投射阴影） ---------------------
const floorMat = new ColorMaterial(device, new Color(0.62, 0.63, 0.66, 1), { label: "floor" });
const floor = new Mesh(Geometry.create(device, plane(40, 40, 1, 1)));
floor.model.setIdentity().rotateX(degToRad(-90));
floor.material = floorMat;
scene.add(floor);

const boxMat = new ColorMaterial(device, new Color().setHex("#e2704a"), { label: "boxes" });
const blueMat = new ColorMaterial(device, new Color().setHex("#4c8dff"), { label: "blues" });
const sphereMat = new ColorMaterial(device, new Color().setHex("#38ffd0"), { label: "spheres" });
const movers: Mesh[] = [];
for (let i = 0; i < 5; i++) {
  const mesh = new Mesh(Geometry.create(device, i % 2 === 0 ? box(1.4, 1.2 + i * 0.5, 1.4) : torus(0.8, 0.3, 32, 16)));
  mesh.setPosition((i - 2) * 2.6, 0.6 + i * 0.25, 0);
  mesh.material = i % 2 === 0 ? boxMat : blueMat;
  scene.add(mesh);
  movers.push(mesh);
}

const tall = new Mesh(Geometry.create(device, box(0.9, 5, 0.9)));
tall.setPosition(-4.4, 2.5, -3.2);
tall.material = boxMat;
scene.add(tall);

const ball = new Mesh(Geometry.create(device, sphere(0.9, 32, 20)));
ball.setPosition(3.4, 3.6, -2.4);
ball.material = sphereMat;
scene.add(ball);
const ballAnchor = { x: 3.4, z: -2.4, y: 3.6, h: 0.5 };

// 悬空平板 + 立柱：验证「影子落到别的物体/空中」
const shelf = new Mesh(Geometry.create(device, box(3.2, 0.3, 3.2)));
shelf.setPosition(0, 3.2, -5.2);
shelf.material = blueMat;
scene.add(shelf);

const pillar = new Mesh(Geometry.create(device, box(0.5, 3.2, 0.5)));
pillar.setPosition(0, 1.6, -4.2);
pillar.material = boxMat;
scene.add(pillar);

// 「叠在一起的薄片」——阴影自检里最容易出问题的组合：
// 薄盒子的背面与正面几乎重合，深度偏移/法线偏移不够就会出现自阴影条纹（acne）
const thinMat = new ColorMaterial(device, new Color().setHex("#f5c518"), { label: "thin" });
const stack: Mesh[] = [];
for (let i = 0; i < 3; i++) {
  const plate = new Mesh(Geometry.create(device, box(2.6 - i * 0.5, 0.18, 2.6 - i * 0.5)));
  plate.setPosition(4.6, 0.09 + i * 0.18, 2.2);
  plate.material = thinMat;
  scene.add(plate);
  stack.push(plate);
}
// 一个斜面（斜坡）：掠射角最容易出现条纹
const ramp = new Mesh(Geometry.create(device, box(3.4, 0.2, 3.4)));
ramp.model.setIdentity().translate(-4.8, 0.9, 2.6).rotateZ(degToRad(28));
ramp.material = thinMat;
scene.add(ramp);

// 自阴影（acne）探针：一个孤立的闭合盒子，悬在场景上方、四周没有任何遮挡物 ——
// 它的受光面**本应完全受光**，出现的任何暗斑都是深度偏移不足造成的自阴影条纹。
const acneProbe = new Mesh(Geometry.create(device, box(6, 6, 6)));
acneProbe.setPosition(0, 46, 0);
acneProbe.material = new ColorMaterial(device, new Color(0.72, 0.72, 0.74, 1), { label: "acne-probe" });
acneProbe.visible = false;
scene.add(acneProbe);

scene.add(new AmbientLight("#39415e", 0.45));

const sun = new DirectionalLight(new Vec3(-0.45, -1, -0.35), "#fff1cf", 0.95);
sun.castShadow = true;
sun.shadow.mapSize = 2048;      // 更高分辨率：更真实的软阴影
sun.shadow.filter = "pcf5";     // 5x5 PCF：边缘更柔和
sun.shadow.radius = 2;
sun.shadow.bias = 0.04;        // 世界单位（约 1 个纹素）
sun.shadow.normalBias = 0;     // 0 = 按纹素自动（推荐）
scene.add(sun);

const spot = new SpotLight("#9fd0ff", 260);
spot.setPosition(5.5, 7.5, 4.5);
spot.setDirection(-0.55, -1, -0.45);
spot.setAngle(degToRad(26), 0.35);
spot.distance = 26;
spot.castShadow = true;
spot.shadow.mapSize = 1024;
spot.shadow.radius = 1.6;
spot.shadow.bias = 0.05;
scene.add(spot);

const sceneRenderer = new SceneRenderer();
const shadows = new ShadowRenderer(device, { label: "demo-shadow" });

const state = {
  shadows: true,
  lights: "both" as "sun" | "spot" | "both",
  mapSize: 2048,
  /** 太阳方位角（度） */
  sunYaw: -50,
  /** 太阳高度角（度，负数 = 从上方照下） */
  sunPitch: -48,
  autoSpin: false,   // 默认**不旋转太阳**：旋转会让阴影持续扫动（想演示动态阴影再开）
  orbiting: false,   // 默认聚光也不绕场（保持画面稳定）
};
applyUrlOverrides(state, params);
function applyState(): void {
  sun.castShadow = state.shadows && state.lights !== "spot";
  spot.castShadow = state.shadows && state.lights !== "sun";
  sun.shadow.mapSize = state.mapSize;
  spot.shadow.mapSize = state.mapSize;
  sun.visible = state.lights !== "spot";
  spot.visible = state.lights !== "sun";
}

// ---- HUD ------------------------------------------------------------------
const hud = document.createElement("div");
hud.id = "shadow-hud";
hud.style.cssText =
  "position:fixed;left:12px;top:12px;color:#d7d9e0;font:12px/1.6 ui-monospace,Consolas,monospace;" +
  "background:rgba(16,18,26,.72);border:1px solid #2b3040;border-radius:8px;padding:10px 12px;z-index:20;white-space:pre;pointer-events:none";
document.body.appendChild(hud);

function updateHud(): void {
  hud.textContent =
    `backend   : ${device.kind}\n` +
    `阴影      : ${state.shadows ? "开" : "关"}  贴图 ${state.mapSize}px\n` +
    `灯光      : ${state.lights}（方向光 ${sun.castShadow ? "投影" : "不投影"} / 聚光 ${spot.castShadow ? "投影" : "不投影"}）\n` +
    `阴影片数  : ${shadows.stats.maps}  跳过 ${shadows.stats.skipped}  阴影 pass 绘制 ${shadows.stats.drawn}\n` +
    `拟合包围球: 半径 ${shadows.boundsRadius.toFixed(2)}  中心 (${shadows.boundsCenter.x.toFixed(2)}, ${shadows.boundsCenter.y.toFixed(2)}, ${shadows.boundsCenter.z.toFixed(2)})\n` +
    `面板      : 右上角 lil-gui 可调（?gui=0 关闭）`;
}

const input = new InputManager(canvas, { preventWheelDefault: true });
input.on("keydown", (e) => {
  if (e.code === "KeyS") state.shadows = !state.shadows;
  else if (e.code === "KeyL") state.lights = state.lights === "both" ? "sun" : state.lights === "sun" ? "spot" : "both";
  else if (e.code === "KeyR") sun.direction.set(-1.1, -0.85, 0.6);
  else if (e.code === "Digit1") state.mapSize = 1024;
  else if (e.code === "Digit2") state.mapSize = 2048;
  else return;
  applyState();
  gui?.controllersRecursive().forEach((c) => c.updateDisplay());
});
applyState();

// ---- 参数面板（lil-gui） ----------------------------------------------------
const gui = createGui({ title: "阴影（Shadow Map）", params });
gui.add(state, "shadows").name("开启阴影").onChange(applyState);
gui
  .add(state, "lights", { "方向光 + 聚光": "both", 仅方向光: "sun", 仅聚光: "spot" })
  .name("灯光")
  .onChange(applyState);
gui
  .add(state, "mapSize", { "512": 512, "1024": 1024, "2048": 2048, "4096": 4096 })
  .name("贴图边长")
  .onChange(applyState);
const sunFolder = gui.addFolder("方向光（太阳）");
sunFolder.add(state, "sunYaw", -180, 180, 1).name("方位角").onChange(applySun);
sunFolder.add(state, "sunPitch", -85, -5, 1).name("高度角").onChange(applySun);
sunFolder.add(sun, "intensity", 0, 3, 0.01).name("强度");
sunFolder.add(sun.shadow, "bias", 0, 0.4, 0.005).name("深度偏移（世界单位）");
sunFolder.add(sun.shadow, "normalBias", 0, 0.4, 0.005).name("法线偏移（0=自动）");
sunFolder.add(sun.shadow, "radius", 0, 4, 0.05).name("PCF 半径（纹素）");
sunFolder
  .add(sun.shadow, "filter", { 硬边: "hard", "3x3 PCF": "pcf3", "5x5 PCF": "pcf5" })
  .name("滤波方式");
sunFolder.add(sun.shadow, "intensity", 0, 1, 0.02).name("阴影强度");
sunFolder
  .add(sun.shadow, "side", { "背面（抗自阴影）": "back", "正面（单面几何）": "front", 双面: "double" })
  .name("渲染面");
sunFolder.add(sun.shadow, "stabilize").name("稳定拟合（抗闪烁）");
sunFolder.add(sun.shadow, "areaSize", 0, 40, 0.5).name("正交半宽（0=自动）");
sunFolder.add(state, "autoSpin").name("太阳缓慢转动");
const spotFolder = gui.addFolder("聚光");
spotFolder.add(spot, "intensity", 0, 600, 1).name("强度");
spotFolder.add(spot, "distance", 5, 60, 0.5).name("影响距离");
spotFolder.add(spot.shadow, "bias", 0, 0.4, 0.005).name("深度偏移（世界单位）");
spotFolder.add(spot.shadow, "radius", 0, 4, 0.05).name("PCF 半径");
spotFolder.add(state, "orbiting").name("聚光绕场旋转");
spotFolder.close();
addButtons(gui, "操作", {
  重置太阳: () => {
    state.sunYaw = -50;
    state.sunPitch = -48;
    sun.shadow.areaSize = 0;
    sun.direction.set(-1.1, -0.85, 0.6);
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  },
});

/** 由方位角/高度角设置太阳方向（光的传播方向：从光源射向场景） */
function applySun(): void {
  const yaw = degToRad(state.sunYaw);
  const pitch = degToRad(state.sunPitch);
  const cos = Math.cos(pitch);
  sun.direction.set(-cos * Math.sin(yaw), Math.sin(pitch), -cos * Math.cos(yaw));
}
applySun();

// 允许用 URL 直接覆盖阴影参数（方便在浏览器里调参：?bias=0.1&side=front&filter=pcf5）
{
  const num = (key: string, apply: (v: number) => void): void => {
    if (!params.has(key)) return;
    const v = Number(params.get(key));
    if (Number.isFinite(v)) apply(v);
  };
  const bool = (key: string, apply: (v: boolean) => void): void => {
    if (!params.has(key)) return;
    const raw = params.get(key)!;
    apply(raw !== "0" && raw !== "false");
  };
  num("bias", (v) => (sun.shadow.bias = v));
  num("normalBias", (v) => (sun.shadow.normalBias = v));
  num("radius", (v) => (sun.shadow.radius = v));
  num("intensity", (v) => (sun.shadow.intensity = v));
  num("areaSize", (v) => (sun.shadow.areaSize = v));
  num("mapSize", (v) => (state.mapSize = v));
  bool("stabilize", (v) => (sun.shadow.stabilize = v));
  const filter = params.get("filter");
  if (filter) sun.shadow.filter = filter as typeof sun.shadow.filter;
  const side = params.get("side");
  if (side) sun.shadow.side = side as typeof sun.shadow.side;
}

// ---- 自检 ------------------------------------------------------------------
const selfTest = params.get("selftest") !== "0";
let frames = 0;
let elapsed = 0;
let tested = false;
let frozen = false;

function luma(pixels: Uint8Array, i: number): number {
  return (0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!) / 255;
}

/** 阴影遮罩：相对**同一光照方向**的无阴影基准，变暗的像素 */
function shadowMask(plain: Uint8Array, shadowed: Uint8Array, out: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < plain.length; i += 4) {
    const darker = luma(plain, i) - luma(shadowed, i) > 0.02;
    out[i >> 2] = darker ? 1 : 0;
    if (darker) count++;
  }
  return count;
}

async function renderOffscreen(withShadows: boolean): Promise<Uint8Array> {
  const target = new RenderTarget(device, {
    width: canvas.width,
    height: canvas.height,
    format: canvasFormat,
    label: "shadow-selftest",
  });
  // 阴影 pass 必须单独提交（WebGPU 禁止同一 submit 内既写又读同一张纹理）
  if (withShadows) shadows.renderAndSubmit(scene, camera, sceneRenderer, 1 / 60);
  else shadows.clear();
  const encoder = device.createCommandEncoder("shadow-selftest");
  const pass = encoder.beginRenderPass({
    label: "shadow-selftest-scene",
    colorAttachments: [target.colorAttachment({ clearValue: { r: 0.04, g: 0.047, b: 0.067, a: 1 } })],
    depthStencilAttachment: target.depthAttachment(),
  });
  sceneRenderer.render(pass, scene, camera);
  pass.end();
  device.submit([encoder.finish()]);
  const pixels = await target.readPixels();
  target.dispose();
  return pixels;
}

async function runSelfTest(): Promise<void> {
  frozen = true; // 自检期间冻结动画：否则两张图之间场景会移动，比较会失真
  const dirA = new Vec3(-0.85, -1, -0.55);
  const dirB = new Vec3(0.45, -1, -0.9);
  const total = canvas.width * canvas.height;
  const maskA = new Uint8Array(total);
  const maskB = new Uint8Array(total);

  sun.direction.copy(dirA);
  const plainA = await renderOffscreen(false);
  const shadowedA = await renderOffscreen(true);
  sun.direction.copy(dirB);
  const plainB = await renderOffscreen(false);
  const shadowedB = await renderOffscreen(true);
  sun.direction.copy(dirA);
  frozen = false;

  const countA = shadowMask(plainA, shadowedA, maskA);
  const countB = shadowMask(plainB, shadowedB, maskB);
  let brighter = 0;
  let sumOn = 0;
  let sumOff = 0;
  for (let i = 0; i < plainA.length; i += 4) {
    if (luma(shadowedA, i) > luma(plainA, i) + 0.02) brighter++;
    sumOn += luma(shadowedA, i);
    sumOff += luma(plainA, i);
  }
  let movedAway = 0;
  let movedIn = 0;
  for (let p = 0; p < total; p++) {
    if (maskA[p] && !maskB[p]) movedAway++;
    if (!maskA[p] && maskB[p]) movedIn++;
  }

  // ---- 质量指标 1：自阴影条纹（acne）----------------------------------------
  // 把「薄片 + 斜坡 + 立面」单独放到一个空旷的场景里、只留太阳，
  // 统计它们**本应完全受光**的像素里有多少被判定为阴影 —— 这直接量化 acne。
  const acne = await measureAcne();

  // ---- 质量指标 2：抖动（闪烁）---------------------------------------------
  // 让相机绕轨道做**极小**位移（0.01 弧度），理想的阴影贴图应该几乎不变化；
  // 采样网格未对齐/拟合不稳定时，整个阴影图案会逐帧跳动（暗/亮边界大面积翻转）。
  const jitter = await measureJitter();

  // ---- 质量指标 3：参数换算 --------------------------------------------------
  const map = shadows.resources.maps[0];
  const quality = {
    texelWorld: Number((map?.texelWorld ?? 0).toFixed(5)),
    biasDepth: Number(shadows.stats.biasDepth.toFixed(6)),
    normalBias: 0,
  };

  const result = {
    backend: device.kind,
    shadowedRatioA: Number((countA / total).toFixed(4)),
    shadowedRatioB: Number((countB / total).toFixed(4)),
    brighterRatio: Number((brighter / total).toFixed(4)),
    meanOn: Number((sumOn / total).toFixed(4)),
    meanOff: Number((sumOff / total).toFixed(4)),
    movedAway: Number((movedAway / total).toFixed(4)),
    movedIn: Number((movedIn / total).toFixed(4)),
    drawn: shadows.stats.drawn,
    acneRatio: Number(acne.toFixed(5)),
    jitterRatio: Number(jitter.maskJitter.toFixed(5)),
    mapJitter: Number(jitter.mapJitter.toFixed(5)),
    ...quality,
    normalBiasAuto: Number((map ? map.texelWorld * 1.5 : 0).toFixed(5)),
    shadowOk: countA / total > 0.01 && countB / total > 0.01 && brighter / total < 0.005,
    moveOk: movedAway / total > 0.002 && movedIn / total > 0.002,
    exposureOk: Math.abs(sumOn - sumOff) / Math.max(1e-4, sumOff) < 0.25,
    // 本应受光的区域里出现阴影的像素比例要极低（自阴影条纹）
    acneOk: acne < 0.004,
    // 相机微动时阴影贴图本身应几乎不变（拟合稳定 → 不闪）
    mapJitterOk: jitter.mapJitter < 0.02,
    // 最终画面里阴影边缘的翻转也要极少
    jitterOk: jitter.maskJitter < 0.01,
  };
  console.log("SHADOW_SELFTEST " + JSON.stringify(result));
  if (params.get("debug") === "1") {
    console.log("SHADOW_MAP_DEBUG " + JSON.stringify(await inspectShadowMap()));
  }
}

/**
 * 自阴影条纹（acne）量化：
 *
 * 场景里**只留一个孤立的悬空盒子**（四周无遮挡）：它朝向太阳的面本应完全受光，
 * 统计「开阴影后变暗」的像素比例即可量化 acne。理想值接近 0；
 * 深度偏移/法线偏移不足时（尤其是薄片、斜面）会出现明显条纹。
 */
async function measureAcne(): Promise<number> {
  const hidden = hideAllExcept(acneProbe);
  acneProbe.visible = true;
  const saved = saveCamera();
  camera.center.set(0, 46, 0);
  camera.yaw = 0.4;
  camera.pitch = 0.45;
  camera.distance = 16;
  camera.update();
  shadows.resetFit(); // 相机瞬移：不要平滑过渡，直接按探针尺寸拟合

  const plain = await renderOffscreen(false);
  const shadowed = await renderOffscreen(true);
  let wronglyShadowed = 0;
  let lit = 0;
  for (let i = 0; i < plain.length; i += 4) {
    const l = luma(plain, i);
    if (l < 0.06) continue; // 背景不参与统计
    lit++;
    if (l - luma(shadowed, i) > 0.02) wronglyShadowed++;
  }

  acneProbe.visible = false;
  restoreVisibility(hidden);
  restoreCamera(saved);
  return lit > 0 ? wronglyShadowed / lit : 0;
}

/**
 * 抖动（闪烁）量化，两个指标：
 *
 * 1. `mapJitter`：相机绕轨道微动 0.01 弧度后，**阴影贴图**本身有多少纹素发生变化。
 *    拟合稳定（中心量化 + 纹素对齐）时应该接近 0 —— 这是"影子闪"的直接度量；
 * 2. `maskJitter`：两次渲染的阴影遮罩（各自相对自己的无阴影基准）翻转比例，
 *    反映最终画面里阴影边缘的跳动。
 */
async function measureJitter(): Promise<{ mapJitter: number; maskJitter: number }> {
  const savedYaw = camera.yaw;
  const plainA = await renderOffscreen(false);
  const shadowedA = await renderOffscreen(true);
  const mapA = await readShadowMapPixels();
  camera.yaw = savedYaw + 0.01;
  camera.update();
  const plainB = await renderOffscreen(false);
  const shadowedB = await renderOffscreen(true);
  const mapB = await readShadowMapPixels();
  camera.yaw = savedYaw;
  camera.update();

  let flips = 0;
  let maskDiff = 0;
  for (let i = 0; i < plainA.length; i += 4) {
    const a = luma(plainA, i) - luma(shadowedA, i) > 0.02;
    const b = luma(plainB, i) - luma(shadowedB, i) > 0.02;
    if (a !== b) maskDiff++;
    flips++;
  }
  let mapDiff = 0;
  let mapTotal = 0;
  if (mapA && mapB) {
    for (let i = 0; i < mapA.length; i += 4) {
      mapTotal++;
      if (Math.abs(mapA[i]! - mapB[i]!) > 2) mapDiff++;
    }
  }
  return {
    mapJitter: mapTotal > 0 ? mapDiff / mapTotal : 1,
    maskJitter: flips > 0 ? maskDiff / flips : 0,
  };
}

/** 隐藏除 `keep`（及其父链）之外的所有网格，返回被隐藏的物体以便恢复 */
function hideAllExcept(keep: Mesh): Mesh[] {
  const hidden: Mesh[] = [];
  for (const child of scene.children) {
    if (child === keep) continue;
    if (child instanceof Mesh && child.visible) {
      child.visible = false;
      hidden.push(child);
    }
  }
  return hidden;
}

function restoreVisibility(hidden: readonly Mesh[]): void {
  for (const mesh of hidden) mesh.visible = true;
}

function saveCamera(): { yaw: number; pitch: number; distance: number; center: Vec3 } {
  return { yaw: camera.yaw, pitch: camera.pitch, distance: camera.distance, center: camera.center.clone() };
}

function restoreCamera(saved: { yaw: number; pitch: number; distance: number; center: Vec3 }): void {
  camera.yaw = saved.yaw;
  camera.pitch = saved.pitch;
  camera.distance = saved.distance;
  camera.center.copy(saved.center);
  camera.update();
}

/** 把第 0 张阴影贴图渲染到离屏目标并回读（用于量化"贴图本身有没有跳"） */
async function readShadowMapPixels(size = 128): Promise<Uint8Array | null> {
  const map = shadows.resources.maps[0];
  if (!map) return null;
  const target = new RenderTarget(device, { width: size, height: size, format: canvasFormat, depth: false, label: "shadow-map-read" });
  const show = new FullScreenPass(device, {
    name: "read-shadow-map",
    nearest: true,
    targetFormat: target.format,
    // 输入是**深度纹理**：WebGPU 必须声明 depth 采样类型 + `texture_depth_2d`，
    // 否则绑定校验失败（整帧命令作废、回读全是 0，mapJitter 会假通过）。
    textureSampleType: "depth",
    fragment: {
      glsl: `#version 300 es
precision highp float;
${POSTFX_COMMON_GLSL}
void main() {
  float d = texelFetch(u_input, ivec2(v_uv * vec2(textureSize(u_input, 0))), 0).r;
  fragColor = vec4(vec3(d), 1.0);
}`,
      wgsl: `
struct ParamsBlock {
  u_texelSize : vec4f,
  u_params : vec4f,
  u_params2 : vec4f,
};
@group(0) @binding(0) var<uniform> fx : ParamsBlock;
@group(0) @binding(1) var u_input : texture_depth_2d;
@group(0) @binding(2) var u_inputSampler : sampler;

struct FSIn {
  @builtin(position) clip_pos : vec4f,
  @location(0) v_uv : vec2f,
};
@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  let texSize = vec2f(textureDimensions(u_input, 0));
  let t = vec2i(floor(vec2f(in.v_uv.x, 1.0 - in.v_uv.y) * texSize));
  return vec4f(vec3f(textureLoad(u_input, t, 0)), 1.0);
}`,
    },
  });
  const encoder = device.createCommandEncoder("shadow-map-read");
  const pass = encoder.beginRenderPass({
    label: "read-shadow-map",
    colorAttachments: [target.colorAttachment({ clearValue: { r: 0, g: 0, b: 0, a: 1 } })],
    depthStencilAttachment: null,
  });
  show.draw(pass, map.texture, size, size);
  pass.end();
  device.submit([encoder.finish()]);
  const pixels = await target.readPixels();
  show.dispose();
  target.dispose();
  return pixels;
}

// ---- 无头调试：把阴影贴图深度可视化成 ASCII ---------------------------------
async function inspectShadowMap(): Promise<Record<string, number | string>> {
  frozen = true;
  sun.direction.set(-0.85, -1, -0.55);
  shadows.renderAndSubmit(scene, camera, sceneRenderer, 1 / 60);
  const map = shadows.resources.maps[0];
  if (!map) return { error: "no shadow map" };
  const size = 256;
  const target = new RenderTarget(device, {
    width: size,
    height: size,
    format: canvasFormat,
    depth: false,
    label: "shadow-map-debug",
  });
  const show = new FullScreenPass(device, {
    name: "show-shadow-map",
    nearest: true,
    targetFormat: target.format,
    // 同 readShadowMapPixels：深度纹理必须声明 depth 采样类型
    textureSampleType: "depth",
    fragment: {
      glsl: `#version 300 es
precision highp float;
${POSTFX_COMMON_GLSL}
void main() {
  // 深度贴图：texelFetch 读原始深度（1 = 清屏值 = 最远）
  float d = texelFetch(u_input, ivec2(v_uv * vec2(textureSize(u_input, 0))), 0).r;
  fragColor = vec4(vec3(d), 1.0);
}`,
      wgsl: `
struct ParamsBlock {
  u_texelSize : vec4f,
  u_params : vec4f,
  u_params2 : vec4f,
};
@group(0) @binding(0) var<uniform> fx : ParamsBlock;
@group(0) @binding(1) var u_input : texture_depth_2d;
@group(0) @binding(2) var u_inputSampler : sampler;

struct FSIn {
  @builtin(position) clip_pos : vec4f,
  @location(0) v_uv : vec2f,
};
@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  let texSize = vec2f(textureDimensions(u_input, 0));
  let t = vec2i(floor(vec2f(in.v_uv.x, 1.0 - in.v_uv.y) * texSize));
  return vec4f(vec3f(textureLoad(u_input, t, 0)), 1.0);
}`,
    },
  });
  const encoder = device.createCommandEncoder("shadow-map-debug");
  const pass = encoder.beginRenderPass({
    label: "show-shadow-map",
    colorAttachments: [target.colorAttachment({ clearValue: { r: 0, g: 0, b: 0, a: 1 } })],
    depthStencilAttachment: null,
  });
  show.draw(pass, map.texture, size, size);
  pass.end();
  device.submit([encoder.finish()]);
  const pixels = await target.readPixels();
  show.dispose();
  target.dispose();
  frozen = false;

  let min = 255;
  let max = 0;
  let sum = 0;
  let nonFar = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const v = pixels[i]!;
    min = Math.min(min, v);
    max = Math.max(max, v);
    sum += v;
    if (v < 250) nonFar++;
  }
  return {
    mapSize: map.size,
    min,
    max,
    mean: Number((sum / (pixels.length / 4)).toFixed(2)),
    nonFarRatio: Number((nonFar / (pixels.length / 4)).toFixed(4)),
    boundsRadius: Number(shadows.boundsRadius.toFixed(3)),
    art: mapArt(pixels, size),
  };
}

function mapArt(pixels: Uint8Array, size: number): string {
  const cols = 56;
  const rows = 16;
  const lines: string[] = [];
  for (let cy = 0; cy < rows; cy++) {
    let line = "";
    for (let cx = 0; cx < cols; cx++) {
      const x = Math.floor(((cx + 0.5) * size) / cols);
      const y = Math.floor(((cy + 0.5) * size) / rows);
      const v = pixels[(y * size + x) * 4]!;
      line += v > 250 ? " " : v > 200 ? "." : v > 120 ? "+" : "#";
    }
    lines.push(line);
  }
  return "\n" + lines.join("\n");
}

// ---- 主循环 ---------------------------------------------------------------
function animate(t: number): void {
  if (frozen) return;
  // 太阳缓慢转（阴影随之移动）；聚光画圈；小球上下浮动
  if (state.autoSpin) {
    state.sunYaw = -50 + Math.sin(t * 0.25) * 30;
    applySun();
  }
  if (state.orbiting) {
    spot.setPosition(Math.cos(t * 0.45) * 6, 7.5, Math.sin(t * 0.45) * 6);
    spot.setDirection(-Math.cos(t * 0.45) * 0.7, -1, -Math.sin(t * 0.45) * 0.7);
  }
  ball.setPosition(ballAnchor.x, ballAnchor.y + Math.sin(t * 1.1) * ballAnchor.h, ballAnchor.z);
  for (let i = 0; i < movers.length; i++) {
    const m = movers[i]!;
    m.model.setIdentity().translate(m.position.x, m.position.y, m.position.z).rotateY(t * 0.4 * (i % 2 === 0 ? 1 : -1));
    m.markDirty();
  }
  camera.update();
}

function loop(): void {
  frames++;
  elapsed += 1 / 60;
  status.frames = frames;
  if (renderer.resizeToDisplaySize(2)) {
    camera.aspect = canvas.width / Math.max(1, canvas.height);
    camera.update();
  }
  animate(elapsed);

  // 阴影必须**先提交**（`Renderer.beginFrame()` 里已经打开了画布 pass，无法再往同一个
  // encoder 前插；两次 submit 的队列顺序仍然正确）
  shadows.renderAndSubmit(scene, camera, sceneRenderer, 1 / 60);

  const pass = renderer.beginFrame();
  sceneRenderer.render(pass, scene, camera);
  renderer.endFrame();
  updateHud();

  if (selfTest && !tested && frames === 30) {
    tested = true;
    void runSelfTest().catch((e) => console.log("SHADOW_SELFTEST_ERROR " + (e instanceof Error ? e.message : String(e))));
  }
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
