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
import { FullScreenPass, POSTFX_COMMON_GLSL, POSTFX_COMMON_WGSL } from "../../src/render/postfx/index.js";
import { ShadowRenderer } from "../../src/render/shadow/index.js";
import { InputManager } from "../../src/interaction/InputManager.js";
import { attachOrbitControls } from "../common/demo.js";

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

scene.add(new AmbientLight("#39415e", 0.45));

const sun = new DirectionalLight(new Vec3(-0.45, -1, -0.35), "#fff1cf", 0.95);
sun.castShadow = true;
sun.shadow.mapSize = 1024;
sun.shadow.radius = 1.6;
sun.shadow.bias = 0.0016;
sun.shadow.normalBias = 0.035;
scene.add(sun);

const spot = new SpotLight("#9fd0ff", 260);
spot.setPosition(5.5, 7.5, 4.5);
spot.setDirection(-0.55, -1, -0.45);
spot.setAngle(degToRad(26), 0.35);
spot.distance = 26;
spot.castShadow = true;
spot.shadow.mapSize = 1024;
spot.shadow.radius = 1.4;
scene.add(spot);

const sceneRenderer = new SceneRenderer();
const shadows = new ShadowRenderer(device, { label: "demo-shadow" });

const state = { shadows: true, lights: "both" as "sun" | "spot" | "both", mapSize: 1024 };
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
    `keys      : S 阴影 · L 灯光 · R 转太阳 · 1/2 贴图 1024/2048`;
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
});
applyState();

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
  if (withShadows) shadows.renderAndSubmit(scene, camera, sceneRenderer);
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
    shadowOk: countA / total > 0.01 && countB / total > 0.01 && brighter / total < 0.005,
    moveOk: movedAway / total > 0.002 && movedIn / total > 0.002,
    exposureOk: Math.abs(sumOn - sumOff) / Math.max(1e-4, sumOff) < 0.25,
  };
  console.log("SHADOW_SELFTEST " + JSON.stringify(result));
  if (params.get("debug") === "1") {
    console.log("SHADOW_MAP_DEBUG " + JSON.stringify(await inspectShadowMap()));
  }
}

// ---- 无头调试：把阴影贴图深度可视化成 ASCII ---------------------------------
async function inspectShadowMap(): Promise<Record<string, number | string>> {
  frozen = true;
  sun.direction.set(-0.85, -1, -0.55);
  shadows.renderAndSubmit(scene, camera, sceneRenderer);
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
${POSTFX_COMMON_WGSL}
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
  sun.direction.set(-0.55 + Math.sin(t * 0.25) * 0.5, -1, -0.35 + Math.cos(t * 0.25) * 0.4);
  spot.setPosition(Math.cos(t * 0.45) * 6, 7.5, Math.sin(t * 0.45) * 6);
  spot.setDirection(-Math.cos(t * 0.45) * 0.7, -1, -Math.sin(t * 0.45) * 0.7);
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
  shadows.renderAndSubmit(scene, camera, sceneRenderer);

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
