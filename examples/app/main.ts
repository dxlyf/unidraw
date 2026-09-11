/**
 * App 门面示例：一个完整应用该有的样子。
 *
 * - `App.create(canvas)` 一行拿到 device / renderer / scene / camera / input /
 *   mixer / tweens / picker / stats；
 * - 插件：框架自带 `OrbitControlsPlugin`（拖拽旋转 + 滚轮缩放）、
 *   `HighlightPlugin`（GPU 拾取高亮/选中），以及示例内自定义的 `HudPlugin`
 *   （演示 `setup/update/beforeRender/afterRender/resize/dispose` 全生命周期）；
 * - 动画：`AnimationClip` + `Mixer`（自转）与 `Tween`（点击弹出）；
 * - 右上角 lil-gui 面板（`?gui=0` 关掉）可实时改：相机自动旋转/视场角、拾取高亮开关与颜色、
 *   HUD 显示、动画与补间开关、清屏色；键盘快捷键是面板的别名；
 * - `?selftest=1`（默认开）：停表 → 用固定时间步跑若干帧 → 打印 APP_SELFTEST
 *   （无头双后端验证用）。
 */

import { App } from "../../src/app/App.js";
import { definePlugin } from "../../src/app/Plugin.js";
import { OrbitControlsPlugin } from "../../src/app/plugins/OrbitControlsPlugin.js";
import { HighlightPlugin } from "../../src/app/plugins/HighlightPlugin.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box, capsule, cone, cylinder, sphere, torus } from "../../src/render/primitives.js";
import { ColorMaterial, UnlitColorMaterial } from "../../src/render/material.js";
import { Mesh } from "../../src/render/Mesh.js";
import { Color } from "../../src/math/color.js";
import { Vec3 } from "../../src/math/vec3.js";
import { degToRad } from "../../src/math/mmath.js";
import {
  AnimationClip,
  nodeRotationTrack,
  nodePositionTrack,
  tweenNumber,
  tweenVec3,
  vec3Keys,
} from "../../src/animation/index.js";
import type { TextureFormat } from "../../src/gpu/types.js";
import { TextureUsage } from "../../src/gpu/types.js";
import { addButtons, applyUrlOverrides, createGui } from "../common/gui.js";

interface Item {
  mesh: Mesh;
  material: ColorMaterial;
  home: Vec3;
}

// ---------------------------------------------------------------------------
// 自定义插件：HUD（演示插件全生命周期）
// ---------------------------------------------------------------------------
const hudLines: string[] = [];
const hudPlugin = definePlugin({
  name: "hud",
  setup(ctx) {
    const el = document.createElement("div");
    el.id = "app-hud";
    el.style.cssText =
      "position:fixed;left:12px;top:12px;color:#d7d9e0;font:12px/1.6 ui-monospace,Consolas,monospace;" +
      "background:rgba(16,18,26,.72);border:1px solid #2b3040;border-radius:8px;padding:10px 12px;z-index:20;white-space:pre;pointer-events:none";
    document.body.appendChild(el);
    pluginEl = el;
    hudLines.push(`setup  · ${ctx.width}x${ctx.height}`);
  },
  update(ctx, dt, time) {
    void dt;
    hudLines[0] = `app     : ${ctx.device.kind}  ${ctx.width}x${ctx.height}  t=${time.toFixed(2)}s`;
    hudLines[1] = `stats   : frames=${ctx ? appRef!.stats.frames : 0}  fps=${appRef!.stats.fps.toFixed(1)}  dt=${(appRef!.stats.dt * 1000).toFixed(2)}ms`;
    hudLines[2] = `scene   : objects=${appRef!.stats.objects}  drawn=${appRef!.stats.drawn}  culled=${appRef!.stats.culled}  tris=${appRef!.stats.triangles}`;
    hudLines[3] = `anim    : ${appRef!.mixer.activeClipNames.join(", ") || "(none)"}  tweens=${appRef!.tweens.count}`;
    hudLines[4] = `plugins : ${appRef!.plugins.map((p) => p.name ?? "?").join(", ")}`;
    hudLines[5] = `面板    : 右上角 lil-gui 可调（?gui=0 关面板） · 拖拽旋转 · 滚轮缩放 · 悬停/点击高亮`;
    if (pluginEl) pluginEl.textContent = hudLines.join("\n");
  },
  resize(_ctx, w, h) {
    hudLines.push(`resize · ${w}x${h}`);
  },
  dispose() {
    pluginEl?.remove();
    pluginEl = null;
  },
});

let pluginEl: HTMLDivElement | null = null;
let appRef: App | null = null;

// ---------------------------------------------------------------------------
// 应用
// ---------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
const backend = params.get("backend") as "auto" | "webgpu" | "webgl2" | null;
const selfTest = params.get("selftest") !== "0";

const canvas = document.createElement("canvas");
canvas.id = "canvas";
canvas.width = 480;
canvas.height = 300;
document.body.style.cssText = "margin:0;background:#0b0c10;overflow:hidden";
// 关键：给 canvas 明确的 CSS 尺寸，否则显示尺寸跟随 drawing buffer，
// devicePixelRatio 放大后画面会被推到视口之外（看起来“什么都没渲染”）
canvas.style.cssText = "display:block;width:100vw;height:100vh;touch-action:none";
document.body.appendChild(canvas);

const status: { backend: string; err: string; frames: number } = { backend: "", err: "", frames: 0 };
(globalThis as Record<string, unknown>).__unidraw = { get status() { return status; } };
window.addEventListener("error", (e) => (status.err = e.message));
window.addEventListener("unhandledrejection", (e) => {
  status.err = e.reason instanceof Error ? e.reason.message : String(e.reason);
});

const app = await App.create(canvas, { backend: backend ?? "auto", background: "#0d1017", depth: true });
appRef = app;
status.backend = app.device.kind;
const targetFormat = app.device.canvasFormat() as TextureFormat;

// ---- 场景 ----------------------------------------------------------------
const geos = [
  Geometry.create(app.device, box(0.8, 0.8, 0.8)),
  Geometry.create(app.device, sphere(0.48, 32, 20)),
  Geometry.create(app.device, torus(0.4, 0.15, 32, 16)),
  Geometry.create(app.device, cylinder(0.34, 0.34, 0.8, 24, 1)),
  Geometry.create(app.device, cone(0.4, 0.85, 24)),
  Geometry.create(app.device, capsule(0.3, 0.5, 24, 8)),
];
const palette = ["#4c8dff", "#3dd68c", "#ff8f3d", "#f5c518", "#b07cff", "#ff5c8a"];
const items: Item[] = [];
const COLS = 4;
const ROWS = 3;
for (let i = 0; i < COLS * ROWS; i++) {
  const material = new ColorMaterial(app.device, new Color().setHex(palette[i % palette.length]!), { label: `item-${i}` });
  const mesh = new Mesh(geos[i % geos.length]!);
  const cx = (i % COLS) - (COLS - 1) / 2;
  const cz = Math.floor(i / COLS) - (ROWS - 1) / 2;
  const home = new Vec3(cx * 1.7, 0.75, cz * 1.7);
  mesh.setPosition(home.x, home.y, home.z);
  mesh.material = material;
  app.scene.add(mesh);
  items.push({ mesh, material, home });
}

const floor = new Mesh(Geometry.create(app.device, box(16, 0.1, 16)));
floor.setPosition(0, -0.05, 0);
floor.material = new UnlitColorMaterial(app.device, new Color(0.09, 0.1, 0.14, 1), { label: "floor" });
app.scene.add(floor);

// ---- 动画：自转 + 上下浮动（Mixer），点击弹出（Tween） --------------------
const idle = new AnimationClip("idle", { duration: 4 })
  .addTrack(
    nodeRotationTrack(
      app.scene,
      vec3Keys([
        { time: 0, value: [0, 0, 0] },
        { time: 4, value: [0, Math.PI * 0.6, 0] },
      ]),
      { name: "scene-sway" },
    ),
  )
  .addTrack(
    nodePositionTrack(
      items[0]!.mesh,
      vec3Keys([
        { time: 0, value: [items[0]!.home.x, 0.75, items[0]!.home.z], easing: "sineInOut" },
        { time: 2, value: [items[0]!.home.x, 1.5, items[0]!.home.z], easing: "sineInOut" },
        { time: 4, value: [items[0]!.home.x, 0.75, items[0]!.home.z] },
      ]),
    ),
  );
app.mixer.play(idle, { loop: "ping-pong" });

// 纯 Tween：呼吸的地面颜色
const floorColor = new Color(0.09, 0.1, 0.14, 1);
const floorMat = floor.material as UnlitColorMaterial;
const floorTween = app.tweens.add(
  tweenNumber(
    0,
    1,
    2.4,
    (v) => {
      floorColor.set(0.09 + v * 0.05, 0.1 + v * 0.06, 0.14 + v * 0.1, 1);
      floorMat.setColor(floorColor);
    },
    { easing: "sineInOut", repeat: Number.POSITIVE_INFINITY, yoyo: true },
  ),
);

// ---- 参数（URL 可覆盖；GUI 实时改） ------------------------------------------
const state = {
  /** 相机自动旋转（默认关，保持画面与无头回归的确定性） */
  autoRotate: false,
  cameraSpeed: 0.12,
  /** 视场角（度） */
  fov: 60,
  /** 拾取高亮总开关（悬停 + 点击） */
  pick: true,
  /** 选中后是否 Tween 弹一下 */
  selectPop: true,
  highlightColor: "#ffe066",
  /** idle 动画播放 + 速度 */
  animating: true,
  animSpeed: 1,
  /** 地面呼吸补间 */
  floorTween: true,
  showHud: true,
  /** 清屏色 */
  background: "#0d1017",
};
applyUrlOverrides(state, params);

// ---- 插件 ----------------------------------------------------------------
const orbit = new OrbitControlsPlugin();
const highlightMat = new UnlitColorMaterial(app.device, new Color().setHex(state.highlightColor), {
  label: "highlight",
  targetFormat,
});
const highlight = new HighlightPlugin({
  highlight: highlightMat,
  // 拖动相机时不拾取（否则高亮会跟着旧位置闪）；面板关掉拾取时也走同一条短路
  skipWhileDragging: () => orbit.dragging || !state.pick,
  onSelect: (mesh) => {
    if (!state.selectPop) return;
    const item = items.find((it) => it.mesh === mesh);
    if (!item) return;
    // 选中 → Tween 弹一下
    app.tweens.add(
      tweenVec3(
        new Vec3(item.mesh.position.x, item.mesh.position.y, item.mesh.position.z),
        new Vec3(item.home.x * 1.3, 1.7, item.home.z * 1.3),
        0.3,
        (v) => item.mesh.setPosition(v.x, v.y, v.z),
        { easing: "backOut", yoyo: true, repeat: 1 },
      ),
    );
  },
});

await app.useAsync(orbit);
await app.useAsync(highlight);
// ?hud=0 时不注册 HUD 插件（便于只看画布 / 截图对比）
if (params.get("hud") !== "0") await app.useAsync(hudPlugin);

app.camera.setPerspective(degToRad(state.fov), canvas.width / canvas.height, 0.1, 500);
app.camera.center.set(0, 0.7, 0);
app.camera.distance = 8.2;
// 注意：pitch 为正 = 相机在目标「上方」（俯视）；负值会让相机钻到地板下面
app.camera.yaw = 0.35;
app.camera.pitch = 0.34;
app.camera.update();

// ---- 参数面板（lil-gui） ----------------------------------------------------
function applyAnimation(): void {
  app.mixer.timeScale = state.animating ? state.animSpeed : 0;
}

// 补间播完会被 TweenManager 自动移除，所以「关」= 移除 + 停止，「开」= 重新加入并从头播
let floorTweenAdded = true;
function applyFloorTween(): void {
  if (state.floorTween === floorTweenAdded) return;
  if (state.floorTween) {
    floorTween.reset();
    app.tweens.add(floorTween);
  } else {
    app.tweens.remove(floorTween);
    floorTween.stop();
  }
  floorTweenAdded = state.floorTween;
}

function applyFov(): void {
  app.camera.setPerspective(degToRad(state.fov), app.camera.aspect, 0.1, 500);
  app.camera.update();
}

function applyHighlightColor(): void {
  highlightMat.setColor(new Color().setHex(state.highlightColor));
}

function applyHud(): void {
  // ?hud=0 时插件没注册，pluginEl 为 null —— 面板控件此时是空操作
  if (pluginEl) pluginEl.style.display = state.showHud ? "" : "none";
}

function applyPick(): void {
  // 关掉拾取时把已选中的高亮恢复成原材质（悬停高亮会在指针离开时自动清）
  if (!state.pick) highlight.clearSelection();
}

function applyBackground(): void {
  app.setClear(state.background);
}

function resetView(): void {
  app.camera.center.set(0, 0.7, 0);
  app.camera.distance = 8.2;
  app.camera.yaw = 0.35;
  app.camera.pitch = 0.34;
  app.camera.update();
}

function syncControllers(): void {
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
}

const gui = createGui({ title: "App 门面 · 插件与参数", params });

const camFolder = gui.addFolder("相机");
camFolder.add(state, "autoRotate").name("自动旋转");
camFolder.add(state, "cameraSpeed", 0, 0.5, 0.01).name("旋转速度");
camFolder.add(state, "fov", 25, 100, 1).name("视场角 FOV").onChange(applyFov);

const pickFolder = gui.addFolder("拾取 / 高亮");
pickFolder.add(state, "pick").name("拾取高亮").onChange(applyPick);
pickFolder.add(state, "selectPop").name("选中弹出 Tween");
pickFolder.addColor(state, "highlightColor").name("高亮颜色").onChange(applyHighlightColor);

const animFolder = gui.addFolder("动画 / 补间");
animFolder.add(state, "animating").name("播放 idle 动画").onChange(applyAnimation);
animFolder.add(state, "animSpeed", 0, 2, 0.05).name("动画速度").onChange(applyAnimation);
animFolder.add(state, "floorTween").name("地面呼吸补间").onChange(applyFloorTween);
animFolder.close();

const viewFolder = gui.addFolder("显示");
viewFolder.add(state, "showHud").name("显示 HUD").onChange(applyHud);
viewFolder.addColor(state, "background").name("清屏色").onChange(applyBackground);
viewFolder.close();

addButtons(gui, "操作", {
  重置视角: resetView,
  清除选中: () => highlight.clearSelection(),
});

// 键盘快捷键（面板的别名）：Space 动画开关 · R 重置视角 · H HUD · P 拾取
app.input?.on("keydown", (e) => {
  if (e.code === "Space") {
    state.animating = !state.animating;
    applyAnimation();
  } else if (e.code === "KeyR") {
    resetView();
  } else if (e.code === "KeyH") {
    state.showHud = !state.showHud;
    applyHud();
  } else if (e.code === "KeyP") {
    state.pick = !state.pick;
    applyPick();
  } else {
    return;
  }
  syncControllers();
});

// 让 URL 覆盖（?animating=0 / ?floorTween=0 / ?showHud=0 / ?background=…）同样生效
applyAnimation();
applyFloorTween();
applyHud();
applyBackground();

// ---- 自检 ----------------------------------------------------------------
let frames = 0;
let tested = false;
app.onRender((_pass, dt) => {
  frames++;
  status.frames = frames;
  if (state.autoRotate) {
    app.camera.yaw += dt * state.cameraSpeed;
    app.camera.update();
  }
  if (frames === 24) app.resize(400, 250);
  if (selfTest && !tested && frames === 40) {
    tested = true;
    // step() 不可重入：延后到当前帧结束后再做确定性自检
    setTimeout(() => {
      void runSelfTest().catch((e) => console.log("APP_SELFTEST_ERROR " + (e instanceof Error ? e.message : String(e))));
    }, 0);
  }
});

app.start();

async function runSelfTest(): Promise<void> {
  app.stop();
  const before = app.stats.frames;

  // 固定视角 + 固定步进，保证跨后端可比
  app.camera.center.set(0, 0.7, 0);
  app.camera.yaw = 0.3;
  app.camera.pitch = 0.32; // 正值 = 相机在目标上方（俯视）
  app.camera.distance = 8.4;
  app.camera.update();
  app.resize(320, 200);
  const resizedWidth = app.stats.width;
  const resizedHeight = app.stats.height;

  // 冻结动画驱动的时间：先把动作归零（保证跨后端/跨运行的数值完全一致）
  for (const a of app.mixer.actions) a.seek(0).play();
  app.mixer.timeScale = 1;
  const t0 = app.stats.time;
  for (let i = 0; i < 30; i++) app.step(1 / 60);
  const dt = app.stats.time - t0;
  const first = items[0]!;

  // CPU 几何拾取 vs GPU 颜色拾取（画面中心附近的网格点）
  let agree = 0;
  let hits = 0;
  const points = [
    { x: 0, y: 0 },
    { x: -0.4, y: -0.1 },
    { x: 0.4, y: -0.1 },
    { x: 0, y: 0.3 },
  ];
  const picker = app.picker;
  picker.render(app.scene, app.camera);
  for (const p of points) {
    const ray = app.raycast(p);
    const gpu = await picker.pickPixel(p);
    if (ray) hits++;
    if ((ray?.object ?? null) === gpu.mesh) agree++;
  }

  // 离屏渲染一次，确认画面里真有东西（防止「draw 都调用了但相机没喂给材质 → 全空」）
  const rtFormat = (app.device.canvasFormat() ?? "rgba8unorm") as TextureFormat;
  const rtW = 160;
  const rtH = 100;
  const rt = app.device.createTexture({
    label: "app-selftest-color",
    width: rtW,
    height: rtH,
    format: rtFormat,
    usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.COPY_SRC,
  });
  const rtDepth = app.device.createTexture({
    label: "app-selftest-depth",
    width: rtW,
    height: rtH,
    format: "depth24plus",
    usage: TextureUsage.RENDER_ATTACHMENT,
  });
  const enc = app.device.createCommandEncoder("app-selftest");
  const rtPass = enc.beginRenderPass({
    label: "app-selftest",
    colorAttachments: [{ view: rt.view(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    depthStencilAttachment: { view: rtDepth.view(), depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: 1 },
  });
  app.sceneRenderer.render(rtPass, app.scene, app.camera);
  rtPass.end();
  app.device.submit([enc.finish()]);
  const rtPixels = await app.device.readTexturePixels(rt);
  let brightPixels = 0;
  for (let i = 0; i < rtPixels.length; i += 4) {
    const l = 0.2126 * rtPixels[i]! + 0.7152 * rtPixels[i + 1]! + 0.0722 * rtPixels[i + 2]!;
    if (l > 70) brightPixels++;
  }
  const coverage = brightPixels / (rtPixels.length / 4);
  rt.destroy();
  rtDepth.destroy();

  const result = {
    backend: app.device.kind,
    framesBefore: before,
    steps: 30,
    dtSum: Number(dt.toFixed(4)),
    /** resize() 后的尺寸（随后 App 会按 CSS 尺寸自动校正） */
    resizedTo: [resizedWidth, resizedHeight],
    /** 自动校正后的尺寸（canvas CSS 为 100vw×100vh） */
    width: app.stats.width,
    height: app.stats.height,
    objects: app.stats.objects,
    drawn: app.stats.drawn,
    culled: app.stats.culled,
    triangles: app.stats.triangles,
    /** 离屏渲染中「物体亮度像素(L>70)」的占比：>0 说明真的画出了东西 */
    coverage: Number(coverage.toFixed(4)),
    movedX: Number(first.mesh.position.x.toFixed(4)),
    movedY: Number(first.mesh.position.y.toFixed(4)),
    plugins: app.plugins.map((p) => p.name),
    hudLines: hudLines.length,
    pickPoints: points.length,
    pickHits: hits,
    pickAgree: agree,
    // 断言
    loopOk: app.stats.frames === before + 30 && Math.abs(dt - 0.5) < 1e-6,
    sceneOk: app.stats.objects === items.length + 1 && app.stats.drawn === items.length + 1 && app.stats.culled === 0,
    // 画面非空：相机确实喂给了材质、且物体真的被光栅化出来
    renderOk: coverage > 0.01,
    // 曲线：0.75 →(2s, sineInOut)→ 1.5，t=0.5s 时应为 0.75 + 0.75*sineInOut(0.25) ≈ 0.8598
    animOk: Math.abs(first.mesh.position.y - 0.85983) < 5e-4,
    pluginOk: app.plugins.length === 3 && hudLines.length >= 6,
    resizeOk: resizedWidth === 320 && resizedHeight === 200,
    pickOk: agree === points.length && hits > 0,
  };
  console.log("APP_SELFTEST " + JSON.stringify(result));
  app.start();
}
