/**
 * InstancedMesh 示例：**一次绘制**画 N 个实例（同一几何体 + 同一材质 + 同一管线）。
 *
 * - 实例矩阵走 `stepMode: "instance"` 的顶点流（location 3..6，stride 64），
 *   WebGL2 用 `vertexAttribDivisor`、WebGPU 用 `stepMode: "instance"`，语义一致；
 * - `setTRSAt()` 逐实例写入 CPU 缓冲，`SceneRenderer` 每帧自动 `upload()` 脏区间；
 * - 视锥剔除用所有实例的联合包围球（`InstancedMesh.updateWorldBounds`）；
 * - 键盘：**I** 在「InstancedMesh」与「等价 N 个 Mesh」之间切换（画面应完全一致）；
 * - `?selftest=1`（默认）：离屏分别用两种方式渲染同一场景，逐像素比较，
 *   打印 INSTANCED_SELFTEST（`matchOk` = 两条路径结果一致，`drawsInstanced` = 1）。
 */

import { Renderer } from "../../src/render/Renderer.js";
import { Camera } from "../../src/render/Camera.js";
import { Scene, SceneRenderer } from "../../src/scene/index.js";
import { Mesh } from "../../src/render/Mesh.js";
import { InstancedMesh } from "../../src/render/InstancedMesh.js";
import { Geometry } from "../../src/render/Geometry.js";
import { plane, sphere, torus } from "../../src/render/primitives.js";
import { ColorMaterial, PhongMaterial } from "../../src/render/material.js";
import { Color } from "../../src/math/color.js";
import { Vec3 } from "../../src/math/vec3.js";
import { degToRad } from "../../src/math/mmath.js";
import { AmbientLight, DirectionalLight } from "../../src/render/lights/index.js";
import { RenderTarget } from "../../src/render/RenderTarget.js";
import { InputManager } from "../../src/interaction/InputManager.js";
import { attachOrbitControls } from "../common/demo.js";

const canvas = document.createElement("canvas");
canvas.id = "canvas";
canvas.style.cssText = "display:block;width:100vw;height:100vh;touch-action:none";
document.body.style.cssText = "margin:0;background:#0a0c11;overflow:hidden";
document.body.appendChild(canvas);

const params = new URLSearchParams(location.search);
const backend = params.get("backend") as "auto" | "webgpu" | "webgl2" | null;
const INSTANCE_COUNT = Math.max(1, Math.min(4096, Number(params.get("count")) || 512));

const status: { backend: string; err: string; frames: number; fps: number } = { backend: "", err: "", frames: 0, fps: 0 };
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
camera.setPerspective(degToRad(52), canvas.width / Math.max(1, canvas.height), 0.1, 500);
camera.center.set(0, 1.5, 0);
camera.distance = 26;
camera.pitch = 0.35;
camera.yaw = 0.6;
camera.update();
attachOrbitControls(camera, canvas);

// ---- 场景 ------------------------------------------------------------------
const floor = new Mesh(Geometry.create(device, plane(60, 60, 1, 1)));
floor.model.setIdentity().rotateX(degToRad(-90));
floor.material = new ColorMaterial(device, new Color(0.16, 0.17, 0.2, 1), { label: "floor" });
scene.add(floor);

scene.add(new AmbientLight("#39415e", 0.5));
scene.add(new DirectionalLight(new Vec3(-0.5, -1, -0.4), "#fff1cf", 0.9));

const geometry = Geometry.create(device, params.get("geom") === "sphere" ? sphere(0.42, 20, 12) : torus(0.34, 0.14, 18, 10));
const material = new PhongMaterial(device, new Color().setHex("#6fb3ff"), {
  label: "instances",
  shininess: 48,
  specular: 0.7,
  ambient: 0.35,
});

/** 每个实例的位置/朝向（两种渲染方式共用同一份数据，保证结果可比） */
const layout: { x: number; y: number; z: number; yaw: number; scale: number }[] = [];
for (let i = 0; i < INSTANCE_COUNT; i++) {
  const a = i * 2.399963; // 黄金角 → 均匀分布
  const r = Math.sqrt(i / INSTANCE_COUNT) * 13;
  layout.push({ x: Math.cos(a) * r, y: 0.45, z: Math.sin(a) * r, yaw: a, scale: 0.8 + (i % 5) * 0.12 });
}

const instanced = new InstancedMesh(geometry, material, INSTANCE_COUNT, { label: "instanced" });
for (let i = 0; i < INSTANCE_COUNT; i++) {
  const it = layout[i]!;
  instanced.setTRSAt(i, it.x, it.y, it.z, it.yaw, it.scale);
}
instanced.upload();
scene.add(instanced);

// 等价的 N 个普通 Mesh（自检用；`I` 键可在两者之间切换）
const individuals: Mesh[] = [];
const individualGroup = new Scene();
// 两组各自一份地面（同一个 Mesh 只能挂在一个父节点下）
const floorClone = new Mesh(floor.geometry, floor.material);
// 灯光也要各挂一份（同一个灯节点只能在一个父节点下），否则两组光照不一致
individualGroup.add(new AmbientLight("#39415e", 0.5));
individualGroup.add(new DirectionalLight(new Vec3(-0.5, -1, -0.4), "#fff1cf", 0.9));
floorClone.model.setIdentity().rotateX(degToRad(-90));
individualGroup.add(floorClone);
individualGroup.add(floorClone);
for (let i = 0; i < INSTANCE_COUNT; i++) {
  const it = layout[i]!;
  const mesh = new Mesh(geometry, material);
  mesh.setPosition(it.x, it.y, it.z);
  mesh.setRotation(0, it.yaw, 0);
  mesh.setScale(it.scale, it.scale, it.scale);
  individuals.push(mesh);
  individualGroup.add(mesh);
}

const sceneRenderer = new SceneRenderer();
const state = { instanced: params.get("mode") !== "mesh", spin: true };
let fpsAccum = 0;
let fpsFrames = 0;
let fps = 0;

// ---- HUD ------------------------------------------------------------------
const hud = document.createElement("div");
hud.id = "instanced-hud";
hud.style.cssText =
  "position:fixed;left:12px;top:12px;color:#d7d9e0;font:12px/1.6 ui-monospace,Consolas,monospace;" +
  "background:rgba(16,18,26,.72);border:1px solid #2b3040;border-radius:8px;padding:10px 12px;z-index:20;white-space:pre;pointer-events:none";
document.body.appendChild(hud);

function updateHud(): void {
  const drawn = sceneRenderer.stats.drawn;
  hud.textContent =
    `backend   : ${device.kind}\n` +
    `实例数    : ${INSTANCE_COUNT}（容量 ${instanced.capacity}）\n` +
    `渲染方式  : ${state.instanced ? "InstancedMesh（1 次 draw）" : `${INSTANCE_COUNT} 个独立 Mesh`}\n` +
    `本帧 draw : ${drawn}   三角形 ${sceneRenderer.stats.triangles}\n` +
    `fps       : ${fps}\n` +
    `材质/管线 : ${device.programsCreated} 程序 / ${device.pipelinesCreated} 管线（全设备去重）\n` +
    `keys      : I 切换实例化 · 拖拽旋转 · 滚轮缩放`;
}

const input = new InputManager(canvas, { preventWheelDefault: true });
input.on("keydown", (e) => {
  if (e.code !== "KeyI") return;
  state.instanced = !state.instanced;
});

// ---- 自检 ------------------------------------------------------------------
const selfTest = params.get("selftest") !== "0";
let frames = 0;
let elapsed = 0;
let tested = false;
let frozen = false;

async function renderOffscreen(useInstanced: boolean): Promise<{ pixels: Uint8Array; draws: number }> {
  const target = new RenderTarget(device, {
    width: canvas.width,
    height: canvas.height,
    format: canvasFormat,
    label: "instanced-selftest",
  });
  const encoder = device.createCommandEncoder("instanced-selftest");
  const pass = encoder.beginRenderPass({
    label: "instanced-selftest-scene",
    colorAttachments: [target.colorAttachment({ clearValue: { r: 0.04, g: 0.047, b: 0.067, a: 1 } })],
    depthStencilAttachment: target.depthAttachment(),
  });
  const root = useInstanced ? scene : individualGroup;
  sceneRenderer.render(pass, root, camera);
  pass.end();
  device.submit([encoder.finish()]);
  const pixels = await target.readPixels();
  target.dispose();
  const drawCount = useInstanced ? 1 : INSTANCE_COUNT;
  return { pixels, draws: drawCount };
}

async function runSelfTest(): Promise<void> {
  frozen = true; // 冻结动画：实例矩阵每帧变化，否则两张图不可比
  const a = await renderOffscreen(true);
  const b = await renderOffscreen(false);
  let sum = 0;
  let max = 0;
  let differing = 0;
  for (let i = 0; i < a.pixels.length; i++) {
    const d = Math.abs(a.pixels[i]! - b.pixels[i]!);
    sum += d;
    if (d > max) max = d;
    if (d > 8) differing++;
  }
  const total = a.pixels.length;
  const result = {
    backend: device.kind,
    instances: INSTANCE_COUNT,
    drawsInstanced: a.draws,
    drawsIndividual: b.draws,
    meanDiff: Number((sum / total).toFixed(4)),
    maxDiff: max,
    differingRatio: Number((differing / total).toFixed(5)),
    // 两条路径必须给出（几乎）相同的画面；容许少量差异（不同绘制顺序/浮点插值）
    matchOk: sum / total < 1.5 && differing / total < 0.01,
  };
  frozen = false;
  console.log("INSTANCED_SELFTEST " + JSON.stringify(result));
}

// ---- 主循环 ---------------------------------------------------------------
function animate(t: number): void {
  if (frozen || !state.spin) return;
  // 逐实例旋转 + 轻微上下浮动：演示「每帧改一部分实例」的上传路径
  for (let i = 0; i < INSTANCE_COUNT; i++) {
    const it = layout[i]!;
    const y = it.y + Math.sin(t * 1.5 + i * 0.15) * 0.25;
    const yaw = it.yaw + t * 0.6;
    instanced.setTRSAt(i, it.x, y, it.z, yaw, it.scale);
    // 独立 Mesh 用同一套变换，保证「I」键切换时画面一致
    const mesh = individuals[i]!;
    mesh.setPosition(it.x, y, it.z);
    mesh.setRotation(0, yaw, 0);
    mesh.setScale(it.scale, it.scale, it.scale);
  }
  instanced.upload();
  camera.update();
}

function loop(): void {
  try {
    frame();
  } catch (e) {
    status.err = e instanceof Error ? (e.stack ?? e.message) : String(e);
    console.log("INSTANCED_ERROR " + status.err);
  }
  requestAnimationFrame(loop);
}

function frame(): void {
  frames++;
  elapsed += 1 / 60;
  fpsAccum += 1 / 60;
  fpsFrames++;
  if (fpsAccum >= 0.5) {
    fps = Math.round(fpsFrames / fpsAccum);
    fpsAccum = 0;
    fpsFrames = 0;
  }
  status.frames = frames;
  status.fps = fps;
  if (renderer.resizeToDisplaySize(2)) {
    camera.aspect = canvas.width / Math.max(1, canvas.height);
    camera.update();
  }
  animate(elapsed);

  const pass = renderer.beginFrame();
  sceneRenderer.render(pass, state.instanced ? scene : individualGroup, camera);
  renderer.endFrame();
  updateHud();

  if (selfTest && !tested && frames === 20) {
    tested = true;
    void runSelfTest().catch((e) => console.log("INSTANCED_SELFTEST_ERROR " + (e instanceof Error ? e.message : String(e))));
  }
}

requestAnimationFrame(loop);
