/**
 * InstancedMesh 示例：**一次绘制**画 N 个实例（同一几何体 + 同一材质 + 同一管线）。
 *
 * - 实例矩阵走 `stepMode: "instance"` 的顶点流（location 3..6，stride 64），
 *   WebGL2 用 `vertexAttribDivisor`、WebGPU 用 `stepMode: "instance"`，语义一致；
 * - `setTRSAt()` 逐实例写入 CPU 缓冲，`SceneRenderer` 每帧自动 `upload()` 脏区间；
 * - 视锥剔除用所有实例的联合包围球（`InstancedMesh.updateWorldBounds`）；
 * - 键盘：**I** 在「InstancedMesh」与「等价 N 个 Mesh」之间切换（画面应完全一致）；
 * - 右上角 lil-gui 面板：渲染方式 / 实例数 / 几何体 / 自转开关与转速 / 浮动 / 颜色，
 *   `?gui=0` 关面板（无头回归用）；
 * - `?count=` 实例数、`?geom=torus|sphere` 几何体、`?mode=mesh` 初始用独立 Mesh；
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
import { addButtons, applyUrlOverrides, createGui } from "../common/gui.js";

const canvas = document.createElement("canvas");
canvas.id = "canvas";
canvas.style.cssText = "display:block;width:100vw;height:100vh;touch-action:none";
document.body.style.cssText = "margin:0;background:#0a0c11;overflow:hidden";
document.body.appendChild(canvas);

const params = new URLSearchParams(location.search);
const backend = params.get("backend") as "auto" | "webgpu" | "webgl2" | null;
/** 实例数上限（面板滑块 / `?count=` 同一个上限） */
const MAX_INSTANCES = 20000;

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

const material = new PhongMaterial(device, new Color().setHex("#6fb3ff"), {
  label: "instances",
  shininess: 48,
  specular: 0.7,
  ambient: 0.35,
});

// 等价的 N 个普通 Mesh（自检用；`I` 键可在两者之间切换）
const individualGroup = new Scene();
// 两组各自一份地面（同一个 Mesh 只能挂在一个父节点下）
const floorClone = new Mesh(floor.geometry, floor.material);
// 灯光也要各挂一份（同一个灯节点只能在一个父节点下），否则两组光照不一致
individualGroup.add(new AmbientLight("#39415e", 0.5));
individualGroup.add(new DirectionalLight(new Vec3(-0.5, -1, -0.4), "#fff1cf", 0.9));
floorClone.model.setIdentity().rotateX(degToRad(-90));
individualGroup.add(floorClone);
individualGroup.add(floorClone);

// ---- 参数（URL 可覆盖；面板实时改） ------------------------------------------
const state = {
  /** InstancedMesh（1 次 draw）↔ 等价的 N 个独立 Mesh（键盘 I 等价） */
  instanced: params.get("mode") !== "mesh",
  /** 自转 + 上下浮动（关掉后完全静止，便于观察某个瞬间） */
  spin: true,
  /** 每实例自转角速度（rad/s） */
  spinSpeed: 0.6,
  /** 上下浮动幅度 */
  bob: 0.25,
  /** 目标实例数（`?count=` 为初始值；拖动结束后重建实例与数组） */
  count: Math.max(1, Math.min(MAX_INSTANCES, Math.round(Number(params.get("count")) || 512))),
  /** 几何体（`?geom=sphere` 为初始值） */
  geometry: params.get("geom") === "sphere" ? "sphere" : "torus",
  /** 实例基色 */
  color: "#6fb3ff",
};
applyUrlOverrides(state, params);

/** 每个实例的位置/朝向（两种渲染方式共用同一份数据，保证结果可比） */
const layout: { x: number; y: number; z: number; yaw: number; scale: number }[] = [];
/** 已建好的几何体 / 实例化网格 / 独立网格（改实例数或几何体时整体重建） */
let geometry!: Geometry;
let instanced!: InstancedMesh;
let individuals: Mesh[] = [];
/** 当前真正建出来的实例数（`?count=`/面板的目标值在重建后才生效） */
let appliedCount = 0;
let built = false;

/**
 * 重建实例数据：几何体与实例数都参与 GPU 资源大小/内容，必须在 onChange 里显式重建
 * （旧的 InstancedMesh / Mesh / Geometry 不再被引用 → 一并释放，避免切换时泄漏）。
 */
function rebuild(): void {
  const count = Math.max(1, Math.min(MAX_INSTANCES, Math.round(state.count)));
  state.count = count;

  if (built) {
    scene.remove(instanced);
    instanced.instanceBuffer.destroy();
    for (let i = 0; i < individuals.length; i++) individualGroup.remove(individuals[i]!);
    geometry.destroy();
  }

  geometry = Geometry.create(
    device,
    state.geometry === "sphere" ? sphere(0.42, 20, 12) : torus(0.34, 0.14, 18, 10),
  );

  layout.length = 0;
  for (let i = 0; i < count; i++) {
    const a = i * 2.399963; // 黄金角 → 均匀分布
    const r = Math.sqrt(i / count) * 13;
    layout.push({ x: Math.cos(a) * r, y: 0.45, z: Math.sin(a) * r, yaw: a, scale: 0.8 + (i % 5) * 0.12 });
  }

  instanced = new InstancedMesh(geometry, material, count, { label: "instanced" });
  for (let i = 0; i < count; i++) {
    const it = layout[i]!;
    instanced.setTRSAt(i, it.x, it.y, it.z, it.yaw, it.scale);
  }
  instanced.upload();
  scene.add(instanced);

  individuals = [];
  for (let i = 0; i < count; i++) {
    const it = layout[i]!;
    const mesh = new Mesh(geometry, material);
    mesh.setPosition(it.x, it.y, it.z);
    mesh.setRotation(0, it.yaw, 0);
    mesh.setScale(it.scale, it.scale, it.scale);
    individuals.push(mesh);
    individualGroup.add(mesh);
  }
  appliedCount = count;
  built = true;
}
rebuild();

const sceneRenderer = new SceneRenderer();
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
  const pending = state.count === appliedCount ? "" : `　面板 ${state.count} 待「重建实例」`;
  hud.textContent =
    `backend   : ${device.kind}\n` +
    `实例数    : ${appliedCount}（容量 ${instanced.capacity}）${pending}\n` +
    `几何体    : ${state.geometry === "sphere" ? "球体" : "圆环"}\n` +
    `渲染方式  : ${state.instanced ? "InstancedMesh（1 次 draw）" : `${appliedCount} 个独立 Mesh`}\n` +
    `本帧 draw : ${drawn}   三角形 ${sceneRenderer.stats.triangles}\n` +
    `fps       : ${fps}\n` +
    `材质/管线 : ${device.programsCreated} 程序 / ${device.pipelinesCreated} 管线（全设备去重）\n` +
    `面板      : 右上角 lil-gui 可调（?gui=0 关面板）`;
}

// ---- 参数面板（lil-gui） ----------------------------------------------------
const gui = createGui({ title: "InstancedMesh 实例化", params });
gui.add(state, "instanced").name("InstancedMesh（I 键）").onChange(syncControllers);
gui.add(state, "spin").name("自转 / 浮动动画");
gui.add(state, "spinSpeed", 0, 3, 0.05).name("自转速度");
gui.add(state, "bob", 0, 1, 0.01).name("浮动幅度");
gui.add(state, "geometry", { 圆环: "torus", 球体: "sphere" }).name("几何体").onChange(() => {
  rebuild();
  syncControllers();
});
// 实例数要重建 InstancedMesh + instances 数组：拖动结束（松手）才重建，避免每一步都重建
gui.add(state, "count", 1, MAX_INSTANCES, 1).name("实例数（松手重建）").onFinishChange(() => {
  rebuild();
  syncControllers();
});
gui.addColor(state, "color").name("实例颜色").onChange(() => material.setColor(new Color().setHex(state.color)));
addButtons(gui, "操作", {
  重建实例: () => {
    rebuild();
    syncControllers();
  },
  重置视角: () => {
    camera.center.set(0, 1.5, 0);
    camera.distance = 26;
    camera.pitch = 0.35;
    camera.yaw = 0.6;
    camera.update();
  },
});

/** 键盘改状态后把面板刷新到最新值（键鼠两条路径等价） */
function syncControllers(): void {
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
}

const input = new InputManager(canvas, { preventWheelDefault: true });
input.on("keydown", (e) => {
  if (e.code !== "KeyI") return;
  state.instanced = !state.instanced;
  syncControllers();
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
  const drawCount = useInstanced ? 1 : appliedCount;
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
    instances: appliedCount,
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
  for (let i = 0; i < appliedCount; i++) {
    const it = layout[i]!;
    const y = it.y + Math.sin(t * 1.5 + i * 0.15) * state.bob;
    const yaw = it.yaw + t * state.spinSpeed;
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
