/**
 * PBR 材质示例 · `StandardMaterial`（metallic-roughness，对齐 three.js `MeshStandardMaterial`）
 *
 * - **5×5 球体矩阵**（XZ 平面）：行 = 粗糙度（0.05 → 1.0）、列 = 金属度（0 → 1），
 *   经典 PBR 展示矩阵 —— 每个格子一个材质实例（矩阵里每个 (roughness, metalness)
 *   组合都不同，材质数量 = 行×列 + 地面）；
 * - **地面**：`roughness = 1 / metalness = 0` 的粗糙不反光地面，albedo 走 `map`（程序化网格贴图）；
 * - **法线贴图**：程序化切空间法线贴图（`normalMap`），`normalScale` 实时可调；
 * - **灯光**：环境光 + 方向光（太阳）+ 3 个彩色点光绕场（金属行会把高光染成灯光颜色）；
 * - 右上角 **lil-gui**：粗糙度/金属度基准、颜色、自发光（颜色 + 强度）、法线强度/法线贴图、
 *   网格密度（行/列数）、灯光强度、显示网格地面、相机环绕（`?gui=0` 关面板）；
 * - 左上角 **HUD**：后端 / fps / 三角形数 / 材质数（+ 当前矩阵取值范围）；
 * - **键盘**（与面板等价，改完面板自动同步）：1/2 粗糙度 −/+ · 3/4 金属度 −/+ · 5 自发光开关 ·
 *   6 显示地面 · 7/8 网格密度 −/+ · 9/0 灯光强度 −/+ · C 颜色循环 · N 法线贴图开关 ·
 *   [ / ] 法线强度 −/+ · , / . 自发光强度 −/+ · R 恢复默认；
 * - `?selftest=1`（**默认开**，与 shadows/blend/lights 一致）：离屏渲染若干组配置并回读像素，
 *   打印一行 `STD_SELFTEST {json}`（自检拆成「每帧一步」，不会卡住主循环），
 *   字段与阈值取值理由见 `finishSelfTest()` 上方的注释。
 */

import { bootDemo } from "../common/demo.js";
import { addButtons, applyUrlOverrides, createGui } from "../common/gui.js";
import { Geometry } from "../../src/render/Geometry.js";
import { plane, sphere } from "../../src/render/primitives.js";
import { StandardMaterial } from "../../src/render/StandardMaterial.js";
import { rgbaTexture } from "../../src/render/texture.js";
import { Mesh } from "../../src/render/Mesh.js";
import { RenderTarget } from "../../src/render/RenderTarget.js";
import { Color } from "../../src/math/color.js";
import { Vec3 } from "../../src/math/vec3.js";
import { clamp, degToRad } from "../../src/math/mmath.js";
import { LightsState } from "../../src/render/lights/index.js";
import type { Device } from "../../src/device/Device.js";
import type { Texture } from "../../src/device/resources.js";
import type { RenderPassEncoder } from "../../src/command/encoder.js";
import type { TextureFormat } from "../../src/gpu/types.js";

/** 球体矩阵在世界空间里的边长（行列数变化时矩阵整体大小不变，只改球的大小/间距） */
const GRID_EXTENT = 6.2;
/** 取景：相机与自检共用同一组参数，保证自检量的就是默认视角（中心高度 / 俯角 / 距离） */
const CAM_CENTER_Y = 0.45;
const CAM_PITCH = 0.6;
const CAM_DISTANCE = GRID_EXTENT * 1.15;
/** 主方向光强度：既要照亮球体，又要让电介质的漫反射峰值明显低于 HIGHLIGHT_LUMA */
const SUN_INTENSITY = 0.8;
/** 地面固定为深灰（不受面板「颜色」影响，方便对比球体矩阵的颜色响应） */
const FLOOR_COLOR = "#3a4150";
/** 自检用的固定自发光颜色（亮蓝，保证暗部像素明显提亮） */
const TEST_EMISSIVE = "#6f8fff";
/** 颜色循环（键盘 C）用的预设 */
const COLOR_PRESETS = ["#c8ccd2", "#e0a878", "#7fd4c0", "#b07cff"];

// ---- 程序化纹理 -------------------------------------------------------------

/**
 * 网格地面用的 albedo：深色底 + 亮线。
 *
 * 一次 UV 覆盖整块地面（`plane(..., 1, 1)` 的 UV 是 0..1），网格线直接烘进贴图，
 * 因此**不依赖采样器的 repeat 寻址**也能得到网格地面。
 */
function createGridAlbedo(device: Device, size = 256, cells = 12): Texture {
  const texture = rgbaTexture(device, size, size, "std-grid-albedo", "rgba8unorm");
  const data = new Uint8Array(size * size * 4);
  const cell = Math.max(1, Math.floor(size / cells));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const onLine = x % cell < 2 || y % cell < 2;
      const i = (y * size + x) * 4;
      data[i] = onLine ? 108 : 58;
      data[i + 1] = onLine ? 116 : 64;
      data[i + 2] = onLine ? 130 : 76;
      data[i + 3] = 255;
    }
  }
  texture.upload(data);
  return texture;
}

/**
 * 程序化切空间法线贴图：高度场 `h = sin(t·u)·sin(t·v)` 的解析梯度转成法线。
 * （`+Z` 朝外、切空间，`normalScale` 越大起伏越明显；rgba8unorm 是法线贴图的标准格式。）
 */
function createNormalMap(device: Device, size = 128, bumps = 4): Texture {
  const texture = rgbaTexture(device, size, size, "std-normal-map", "rgba8unorm");
  const data = new Uint8Array(size * size * 4);
  const t = Math.PI * 2 * bumps;
  const slope = 0.02;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // dh/du 与 dh/dv（切空间 x/y 方向的坡度）
      const dhdu = t * Math.cos(t * u) * Math.sin(t * v);
      const dhdv = t * Math.sin(t * u) * Math.cos(t * v);
      let nx = -dhdu * slope;
      let ny = -dhdv * slope;
      const inv = 1 / Math.hypot(nx, ny, 1);
      nx *= inv;
      ny *= inv;
      const i = (y * size + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  texture.upload(data);
  return texture;
}

// ---- 自检阈值（取值理由见 finishSelfTest 上方注释） --------------------------
/** 「镜面高光」判定亮度：只有锐利高光的核心能到这么亮 */
const HIGHLIGHT_LUMA = 0.9;
/** 「暗部」判定亮度 */
const DARK_LUMA = 0.25;
/** 离屏自检的清屏色（与主循环一致的深色背景） */
const CLEAR = { r: 0.03, g: 0.031, b: 0.047, a: 1 };
/** 背景亮度（用于把背景像素从「暗部」里剔除） */
const BG_LUMA = 0.2126 * CLEAR.r + 0.7152 * CLEAR.g + 0.0722 * CLEAR.b;

const params = new URLSearchParams(location.search);

interface Cell {
  mesh: Mesh;
  material: StandardMaterial;
  /** 矩阵行（0 = 最光滑端） */
  row: number;
  /** 矩阵列（0 = 纯介电端） */
  col: number;
}

bootDemo({
  title: "PBR · StandardMaterial（metallic-roughness）",
  run(ctx) {
    const device: Device = ctx.device;
    const canvas = ctx.renderer.canvas;
    const cam = ctx.camera;
    // 离屏自检目标必须与材质管线的附件格式一致：材质默认取画布格式
    const canvasFormat = (device.canvasFormat?.() ?? "rgba8unorm") as TextureFormat;

    // ---- 参数（URL 给初值；面板/键盘实时改） --------------------------------
    const state = {
      /** 粗糙度基准：0.5 = 矩阵原值（行 0.05→1.0），<0.5 整体更光滑、>0.5 整体更粗糙 */
      roughness: 0.5,
      /** 金属度基准：0.5 = 矩阵原值（列 0→1），<0.5 整体更介电、>0.5 整体更金属 */
      metalness: 0.5,
      /** 球体基色（地面固定深灰，不跟着变） */
      color: "#c8ccd2",
      /** 自发光颜色（默认纯黑 = 无自发光，与 three.js 一致） */
      emissive: "#000000",
      emissiveIntensity: 1,
      normalMap: true,
      normalScale: 0.6,
      /** 行数（粗糙度方向） */
      rows: 5,
      /** 列数（金属度方向） */
      cols: 5,
      /** 光照强度倍率（环境 + 方向 + 点光一起缩放） */
      lightIntensity: 1,
      /** 显示网格地面 */
      showFloor: true,
      /** 相机缓慢环绕 */
      autoOrbit: true,
    };
    applyUrlOverrides(state, params);
    state.rows = clamp(Math.round(state.rows), 2, 8);
    state.cols = clamp(Math.round(state.cols), 2, 8);

    // ---- 几何与纹理（球体共用一份单位球：逐物体矩阵只做缩放/平移） ----------
    const sphereGeo = Geometry.create(device, sphere(1, 40, 26));
    const floorGeo = Geometry.create(device, plane(GRID_EXTENT * 4, GRID_EXTENT * 4, 1, 1));
    const normalMapTex = createNormalMap(device);

    const floorMesh = new Mesh(floorGeo);
    floorMesh.model.setIdentity().rotateX(degToRad(-90));
    const floorMat = new StandardMaterial(device, {
      color: FLOOR_COLOR,
      roughness: 1,
      metalness: 0,
      map: createGridAlbedo(device),
      normalMap: null,
      label: "pbr-floor",
    });
    floorMesh.material = floorMat;

    // ---- 灯光（显式打包 → 不依赖 SceneRenderer） ---------------------------
    const AMBIENT = new Color().setHex("#4a5570");
    const SUN_COLOR = new Color().setHex("#fff2d8");
    const SUN_DIR = new Vec3(-0.45, -0.85, -0.5);
    const pointColors = ["#ff4d6d", "#3dd68c", "#4c8dff"].map((hex) => new Color().setHex(hex));
    const pointRadius = [4.0, 4.8, 4.4];
    const pointHeight = [2.8, 1.9, 3.6];
    const pointSpeed = [0.5, 0.34, 0.62];
    const pointPhase = [0.0, 2.1, 4.2];
    const pointPos = pointRadius.map(() => new Vec3());
    const lights = new LightsState();

    /**
     * 打包当前灯光。
     *
     * @param withPoints 是否包含彩色点光。自检期间关掉：点光近距离的彩色高光会饱和成白，
     *   给「高光像素计数」引入与粗糙度无关的常量，干扰判定（见 finishSelfTest）。
     */
    function applyLights(withPoints = true): void {
      const k = state.lightIntensity;
      lights.reset();
      lights.addAmbient(AMBIENT, 0.35 * k);
      lights.addDirectional(SUN_DIR, SUN_COLOR, SUN_INTENSITY * k);
      if (withPoints) {
        for (let i = 0; i < pointPos.length; i++) {
          lights.addPoint(pointPos[i]!, pointColors[i]!, 4.2 * k, 7.5, 2);
        }
      }
      lights.finish();
    }
    applyLights();

    /** 面板上的「粗糙度/金属度基准」→ 矩阵原值的缩放倍率（0.5 = 原值） */
    const roughnessOf = (row: number): number => {
      const base = state.rows <= 1 ? 0.05 : 0.05 + 0.95 * (row / (state.rows - 1));
      return clamp(base * (state.roughness / 0.5), 0.02, 1);
    };
    const metalnessOf = (col: number): number => {
      const base = state.cols <= 1 ? 0 : col / (state.cols - 1);
      return clamp(base * (state.metalness / 0.5), 0, 1);
    };

    function createMaterial(roughness: number, metalness: number, label: string): StandardMaterial {
      return new StandardMaterial(device, {
        color: state.color,
        roughness,
        metalness,
        emissive: state.emissive,
        emissiveIntensity: state.emissiveIntensity,
        normalMap: state.normalMap ? normalMapTex : null,
        normalScale: state.normalScale,
        label,
      });
    }

    // ---- 球体矩阵 ----------------------------------------------------------
    let cells: Cell[] = [];

    /** 面板参数（颜色/自发光/法线强度/基准）写回所有球体材质；矩阵密度不变时用它，避免重建 */
    function applyLook(): void {
      for (const cell of cells) {
        const m = cell.material;
        // 冻结接口公开的读写面：全部走 setter（赋值）—— 实现会在 setter 里 flush UBO，
        // 只对 getter 返回的 Color 就地 setHex 不会上传（见 StandardMaterial.flushMaterial）
        m.roughness = roughnessOf(cell.row);
        m.metalness = metalnessOf(cell.col);
        m.color = state.color;
        m.emissive = state.emissive;
        m.emissiveIntensity = state.emissiveIntensity;
        m.normalScale = state.normalScale;
      }
      updateStats();
    }

    /** 行/列数或法线贴图开关变化 → 重建矩阵（材质是 GPU 资源，换绑定要重建材质对象） */
    function rebuildGrid(): void {
      for (const cell of cells) cell.material.dispose();
      cells = [];
      state.rows = clamp(Math.round(state.rows), 2, 8);
      state.cols = clamp(Math.round(state.cols), 2, 8);
      const spacing = GRID_EXTENT / Math.max(state.rows, state.cols);
      const radius = spacing * 0.42;
      for (let row = 0; row < state.rows; row++) {
        for (let col = 0; col < state.cols; col++) {
          const material = createMaterial(roughnessOf(row), metalnessOf(col), `pbr-r${row}c${col}`);
          const mesh = new Mesh(sphereGeo, material);
          // 行 0（最光滑）放在靠近相机的一侧（+Z），行长越大越粗糙、越远
          mesh.model
            .setIdentity()
            .translate((col - (state.cols - 1) / 2) * spacing, radius, ((state.rows - 1) / 2 - row) * spacing)
            .scale(radius, radius, radius);
          cells.push({ mesh, material, row, col });
        }
      }
      applyLook();
    }

    // ---- 渲染 --------------------------------------------------------------
    function drawScene(pass: RenderPassEncoder): void {
      const vp = cam.viewProjection;
      const eye = cam.eyePosition;
      if (state.showFloor) {
        floorMat.beginFrame(vp, eye, lights);
        floorMat.draw(pass, floorMesh);
      }
      for (const cell of cells) {
        cell.material.beginFrame(vp, eye, lights);
        cell.material.draw(pass, cell.mesh);
      }
    }

    /** 当前一帧需要的全部材质实例（HUD 的「材质数」= 球 + 地面） */
    const materialCount = (): number => cells.length + 1;

    // ---- HUD（左上角；bootDemo 的标题/后端/fps 下方追加统计行） -------------
    let fps = 0;
    let hudFrames = 0;
    let hudLast = performance.now();
    const hud = document.querySelector<HTMLElement>(".hud");
    const hudLine = document.createElement("div");
    // .hud 的样式没有 white-space: pre（bootDemo 的标题/后端/fps 都是单行），这里要自己带上
    hudLine.style.whiteSpace = "pre";
    if (hud) hud.appendChild(hudLine);

    function updateStats(): void {
      if (!hud) return;
      const triangles = cells.length * (sphereGeo.indexCount / 3) + (state.showFloor ? floorGeo.indexCount / 3 : 0);
      const last = state.rows - 1;
      const lastCol = state.cols - 1;
      hudLine.textContent =
        `fps       : ${fps}\n` +
        `三角形    : ${Math.round(triangles)}\n` +
        `材质      : ${materialCount()}（球 ${cells.length} + 地面 1）\n` +
        `矩阵      : ${state.rows} 行（粗糙度 ${roughnessOf(0).toFixed(2)}→${roughnessOf(last).toFixed(2)}）` +
        ` × ${state.cols} 列（金属度 ${metalnessOf(0).toFixed(2)}→${metalnessOf(lastCol).toFixed(2)}）\n` +
        `面板/键盘 : 右上角 lil-gui（?gui=0 关）· 1/2 粗糙度 · 3/4 金属度 · 5 自发光 · 6 地面 · 7/8 密度 · 9/0 灯光 · N 法线贴图 · C 颜色 · R 重置`;
    }

    // ---- 参数面板（lil-gui） ----------------------------------------------
    const gui = createGui({ title: "PBR · StandardMaterial", params });
    /** 状态被键盘/按钮改了以后，把面板显示刷新到最新值 */
    const syncControllers = (): void => {
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    };
    gui.add(state, "roughness", 0, 1, 0.01).name("粗糙度（0.5=矩阵原值）").onChange(applyLook);
    gui.add(state, "metalness", 0, 1, 0.01).name("金属度（0.5=矩阵原值）").onChange(applyLook);
    gui.addColor(state, "color").name("颜色").onChange(applyLook);
    gui.addColor(state, "emissive").name("自发光").onChange(applyLook);
    gui.add(state, "emissiveIntensity", 0, 3, 0.01).name("自发光强度").onChange(applyLook);
    gui.add(state, "normalScale", 0, 2, 0.01).name("法线强度").onChange(applyLook);
    gui.add(state, "normalMap").name("法线贴图").onChange(rebuildGrid);
    gui.add(state, "rows", 2, 8, 1).name("网格行数（粗糙度）").onChange(rebuildGrid);
    gui.add(state, "cols", 2, 8, 1).name("网格列数（金属度）").onChange(rebuildGrid);
    gui.add(state, "lightIntensity", 0, 2.5, 0.01).name("灯光强度").onChange(() => applyLights());
    gui.add(state, "showFloor").name("显示网格地面").onChange(updateStats);
    gui.add(state, "autoOrbit").name("相机环绕");
    addButtons(gui, "操作", {
      恢复默认: () => {
        state.roughness = 0.5;
        state.metalness = 0.5;
        state.color = "#c8ccd2";
        state.emissive = "#000000";
        state.emissiveIntensity = 1;
        state.normalMap = true;
        state.normalScale = 0.6;
        state.rows = 5;
        state.cols = 5;
        state.lightIntensity = 1;
        state.showFloor = true;
        state.autoOrbit = true;
        applyLights();
        rebuildGrid();
        syncControllers();
      },
      重置视角: () => resetView(),
    });

    // ---- 键盘（与面板等价） -------------------------------------------------
    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement) return; // 正在面板里输入时不要抢键
      let handled = true;
      switch (e.code) {
        case "Digit1":
          state.roughness = clamp(state.roughness - 0.05, 0, 1);
          applyLook();
          break;
        case "Digit2":
          state.roughness = clamp(state.roughness + 0.05, 0, 1);
          applyLook();
          break;
        case "Digit3":
          state.metalness = clamp(state.metalness - 0.05, 0, 1);
          applyLook();
          break;
        case "Digit4":
          state.metalness = clamp(state.metalness + 0.05, 0, 1);
          applyLook();
          break;
        case "Digit5":
          state.emissive = state.emissive === "#000000" ? TEST_EMISSIVE : "#000000";
          applyLook();
          break;
        case "Digit6":
          state.showFloor = !state.showFloor;
          updateStats();
          break;
        case "Digit7":
          state.rows -= 1;
          state.cols -= 1;
          rebuildGrid();
          break;
        case "Digit8":
          state.rows += 1;
          state.cols += 1;
          rebuildGrid();
          break;
        case "Digit9":
          state.lightIntensity = clamp(state.lightIntensity - 0.1, 0, 2.5);
          applyLights();
          break;
        case "Digit0":
          state.lightIntensity = clamp(state.lightIntensity + 0.1, 0, 2.5);
          applyLights();
          break;
        case "KeyC": {
          const i = COLOR_PRESETS.indexOf(state.color);
          state.color = COLOR_PRESETS[(i + 1) % COLOR_PRESETS.length]!;
          applyLook();
          break;
        }
        case "KeyN":
          state.normalMap = !state.normalMap;
          rebuildGrid();
          break;
        case "BracketLeft":
          state.normalScale = clamp(state.normalScale - 0.1, 0, 2);
          applyLook();
          break;
        case "BracketRight":
          state.normalScale = clamp(state.normalScale + 0.1, 0, 2);
          applyLook();
          break;
        case "Comma":
          state.emissiveIntensity = clamp(state.emissiveIntensity - 0.1, 0, 3);
          applyLook();
          break;
        case "Period":
          state.emissiveIntensity = clamp(state.emissiveIntensity + 0.1, 0, 3);
          applyLook();
          break;
        case "KeyR":
          state.roughness = 0.5;
          state.metalness = 0.5;
          state.color = "#c8ccd2";
          state.emissive = "#000000";
          state.emissiveIntensity = 1;
          state.normalMap = true;
          state.normalScale = 0.6;
          state.rows = 5;
          state.cols = 5;
          state.lightIntensity = 1;
          state.showFloor = true;
          applyLights();
          rebuildGrid();
          break;
        default:
          handled = false;
      }
      if (handled) syncControllers();
    });

    function resetView(): void {
      cam.center.set(0, CAM_CENTER_Y, 0);
      cam.distance = CAM_DISTANCE;
      cam.pitch = CAM_PITCH;
      cam.yaw = 0;
      cam.update();
    }

    // ---- 自检（无头回归） --------------------------------------------------
    const selfTest = params.get("selftest") !== "0";
    let frames = 0;
    let tested = false;
    /** 自检期间冻结动画/相机（被比较的几张图之间场景绝不能动） */
    let frozen = false;
    /**
     * `?freeze=1`：整个页面冻住动画与相机（点光停在初始相位、相机不环绕）。
     *
     * 与上面的 `frozen` 分开：`frozen` 是自检内部开关，自检结束就放开；`urlFrozen`
     * 一旦打开就一直冻着。它的用途是**跨后端逐像素对比** —— 本示例的点光在绕场、
     * 相机在自动环绕，直接截两后端的图必然对不上（实测 meanAbsDiff 15.1/255，
     * 那只是时间差）；冻住之后两个后端渲染的应该是同一幅画面。
     */
    const urlFrozen = params.get("freeze") === "1";

    function luma(pixels: Uint8Array, i: number): number {
      return (0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!) / 255;
    }

    function meanLuma(pixels: Uint8Array): number {
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4) sum += luma(pixels, i);
      return sum / (pixels.length / 4);
    }

    /** 亮度差 > threshold 的像素比例（0..1） */
    function diffRatio(a: Uint8Array, b: Uint8Array, threshold = 0.02): number {
      let differing = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (Math.abs(luma(a, i) - luma(b, i)) > threshold) differing++;
      }
      return differing / (a.length / 4);
    }

    /** 亮度 > threshold 的像素比例（0..1） */
    function ratioAbove(pixels: Uint8Array, threshold: number): number {
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (luma(pixels, i) > threshold) count++;
      return count / (pixels.length / 4);
    }

    const round4 = (v: number): number => Number(v.toFixed(4));

    /**
     * 自检的离屏目标：**惰性创建一次、四张对照图共用**。
     *
     * 为什么这么做：`new RenderTarget` 每次都要新建颜色/深度纹理（ANGLE 上很贵），
     * 而 `readPixels` 又是 GPU 同步点 —— 早期版本「每张图新建目标 + 一条 await 链跑完」
     * 会把一帧阻塞约 6 秒（页面看起来卡死）。现在目标只建一次、尺寸按画布宽高比缩到
     * 256 宽（所有判据都是比例，缩小后同样成立），四张图跑完就 `dispose()`。
     */
    let testTarget: RenderTarget | null = null;

    function testTargetOf(): RenderTarget {
      if (!testTarget) {
        const width = 256;
        const height = Math.max(96, Math.round((width * canvas.height) / Math.max(1, canvas.width)));
        testTarget = new RenderTarget(device, { width, height, format: canvasFormat, label: "std-selftest" });
      }
      return testTarget;
    }

    /** 四张对照图：相邻两张之间**只改一个参数**（地面在自检里统一隐藏，暗部统计只剩球体与背景） */
    interface StdShot {
      name: string;
      roughness: number;
      metalness: number;
      emissive: boolean;
    }
    const STD_SHOTS: StdShot[] = [
      { name: "base", roughness: 0.6, metalness: 0, emissive: false },
      { name: "emissive", roughness: 0.6, metalness: 0, emissive: true },
      { name: "metalHi", roughness: 0.6, metalness: 1, emissive: false },
      { name: "metalLo", roughness: 0.3, metalness: 1, emissive: false },
    ];

    /** 一次离屏渲染（**不含回读**：回读是异步/同步点，单独在下一步做） */
    function renderOffscreenInto(target: RenderTarget): void {
      const encoder = device.createCommandEncoder("std-selftest");
      const pass = encoder.beginRenderPass({
        label: "std-selftest-scene",
        colorAttachments: [target.colorAttachment({ clearValue: CLEAR })],
        depthStencilAttachment: target.depthAttachment(),
      });
      drawScene(pass);
      pass.end();
      device.submit([encoder.finish()]);
    }

    /**
     * 自检状态机（**每帧最多一次离屏渲染 + 一次回读**，绝不把多次回读串成一条长链）：
     *
     * 用 `requestAnimationFrame` 在**每帧的画布 pass 打开之前**推进一步 ——
     * 与 `examples/shadows` 里「阴影 pass 先于 beginFrame 提交」同一个道理。
     * 每一步只做：改材质 → 离屏渲染（同步）→ 立刻恢复材质 → 发起回读（异步）。
     * 回读结果由 `.then` 收进数组，下一帧再推进一步；四张图都到齐后才算断言、打印。
     */
    let testIndex = -1;
    let testBusy = false;
    let testPixels: Uint8Array[] = [];
    let testSaved: { yaw: number; pitch: number; distance: number; center: Vec3 } | null = null;
    let testStart = 0;
    /** 诊断用：自检各步骤的主线程耗时（会打进 STD_SELFTEST，便于回归监控） */
    let testMsRender = 0;
    let testMsRead = 0;
    let testSteps = 0;
    /** 自检开始时的主循环帧号，以及相邻两次推进之间的最大间隔（证明没有单帧阻塞） */
    let testStartFrame = 0;
    let testLastStepAt = 0;
    let testMaxFrameMs = 0;

    function beginSelfTest(): void {
      testSaved = { yaw: cam.yaw, pitch: cam.pitch, distance: cam.distance, center: cam.center.clone() };
      testPixels = [];
      testIndex = 0;
      testBusy = false;
      testMsRender = 0;
      testMsRead = 0;
      testSteps = 0;
      testStart = performance.now();
      testStartFrame = frames;
      testLastStepAt = testStart;
      testMaxFrameMs = 0;
      frozen = true;
      // 固定取景（自检量的就是默认视角）
      cam.center.set(0, CAM_CENTER_Y, 0);
      cam.distance = CAM_DISTANCE;
      cam.pitch = CAM_PITCH;
      cam.yaw = 0;
      cam.update();
      applyLights(false); // 固定光照：去掉彩色点光（见下方阈值说明）
    }

    /** 结束自检：恢复灯光/材质/相机，释放离屏目标（本示例没有 dispose 钩子，这里就是它的唯一归属） */
    function endSelfTest(): void {
      applyLights(true);
      applyLook();
      if (testSaved) {
        cam.center.copy(testSaved.center);
        cam.yaw = testSaved.yaw;
        cam.pitch = testSaved.pitch;
        cam.distance = testSaved.distance;
        cam.update();
        testSaved = null;
      }
      frozen = false;
      testIndex = -1;
      testBusy = false;
      testPixels = [];
      testTarget?.dispose();
      testTarget = null;
    }

    function failSelfTest(e: unknown): void {
      console.log("STD_SELFTEST_ERROR " + (e instanceof Error ? e.message : String(e)));
      endSelfTest();
    }

    /** 推进一步（在 rAF 里调用：此时画布 pass 还没打开） */
    function stepSelfTest(): void {
      if (testIndex < 0) return;
      if (testBusy) {
        // 回读还没回来：下一帧再试（不阻塞、不空转）
        requestAnimationFrame(stepSelfTest);
        return;
      }
      if (testIndex >= STD_SHOTS.length) {
        finishSelfTest();
        return;
      }
      const shot = STD_SHOTS[testIndex]!;
      testSteps++;
      // 相邻两次推进的间隔 = 主循环这一帧的时长；自检若阻塞单帧，这里会看到很大的值
      const stepNow = performance.now();
      testMaxFrameMs = Math.max(testMaxFrameMs, stepNow - testLastStepAt);
      testLastStepAt = stepNow;
      const savedFloor = state.showFloor;
      try {
        // 隐藏地面 + 套用本张图的参数 → 渲染 → **立刻**恢复（这一帧的画布仍按 state 画）
        state.showFloor = false;
        for (const cell of cells) {
          const m = cell.material;
          m.roughness = shot.roughness;
          m.metalness = shot.metalness;
          m.emissive = shot.emissive ? TEST_EMISSIVE : "#000000";
          m.emissiveIntensity = 1;
          m.normalScale = state.normalScale;
        }
        const target = testTargetOf();
        const t0 = performance.now();
        renderOffscreenInto(target);
        testMsRender += performance.now() - t0;
        state.showFloor = savedFloor;
        applyLook();
        testBusy = true;
        const t1 = performance.now();
        target
          .readPixels()
          .then((pixels) => {
            testMsRead += performance.now() - t1;
            testPixels.push(pixels);
            testIndex++;
            testBusy = false;
          })
          .catch(failSelfTest);
      } catch (e) {
        state.showFloor = savedFloor;
        failSelfTest(e);
        return;
      }
      requestAnimationFrame(stepSelfTest);
    }

    /**
     * 全部对照图到齐 → 计算断言并打印 `STD_SELFTEST {json}`。
     * 阈值取值理由见下方注释（亮度都是 0..1 的线性亮度，未做 gamma）。
     */
    function finishSelfTest(): void {
      const [base, emissive, metalHi, metalLo] = testPixels as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
      const total = base.length / 4;
      const meanBase = meanLuma(base);
      const brightRatio = ratioAbove(base, 0.3);
      const diffRoughness = diffRatio(metalHi, metalLo);
      const diffMetalness = diffRatio(base, metalHi);
      const meanMetalHi = meanLuma(metalHi);
      const meanMetalLo = meanLuma(metalLo);
      const highlightHi = ratioAbove(metalHi, HIGHLIGHT_LUMA);
      const highlightLo = ratioAbove(metalLo, HIGHLIGHT_LUMA);

      let darkCount = 0;
      let darkDelta = 0;
      for (let i = 0; i < base.length; i += 4) {
        const l0 = luma(base, i);
        if (l0 >= DARK_LUMA || Math.abs(l0 - BG_LUMA) < 0.02) continue; // 暗部 + 排除背景清屏色
        darkCount++;
        darkDelta += luma(emissive, i) - l0;
      }
      const darkDeltaMean = darkCount > 0 ? darkDelta / darkCount : 0;
      const meanEmissive = meanLuma(emissive);

      const result = {
        backend: device.kind,
        cells: cells.length,
        materials: materialCount(),
        normalMap: state.normalMap,
        size: [testTarget?.width ?? 0, testTarget?.height ?? 0],
        msTotal: Math.round(performance.now() - testStart),
        msRender: Math.round(testMsRender),
        msRead: Math.round(testMsRead),
        stepFrames: testSteps,
        // 自检消耗的主循环帧数（≈ stepFrames + 1）与最长一帧的时长：用于确认「没有单帧阻塞」
        framesSpent: frames - testStartFrame,
        maxFrameMs: Math.round(testMaxFrameMs),
        meanBase: round4(meanBase),
        brightRatio: round4(brightRatio),
        meanMetalHi: round4(meanMetalHi),
        meanMetalLo: round4(meanMetalLo),
        meanEmissive: round4(meanEmissive),
        diffRoughness: round4(diffRoughness),
        diffMetalness: round4(diffMetalness),
        highlightHi: round4(highlightHi),
        highlightLo: round4(highlightLo),
        darkRatio: round4(darkCount / total),
        darkDelta: round4(darkDeltaMean),
        // 断言
        renderOk: meanBase > 0.05 && brightRatio > 0.02,
        roughnessOk: diffRoughness > 0.03,
        metalnessOk: diffMetalness > 0.03,
        highlightOk: highlightLo > highlightHi * 1.3 && highlightLo > 0.0001 && meanMetalLo < meanMetalHi + 0.08,
        emissiveOk: darkCount > total * 0.01 && darkDeltaMean > 0.05 && meanEmissive > meanBase + 0.005,
      };
      console.log("STD_SELFTEST " + JSON.stringify(result));
      endSelfTest();
    }

    /**
     * 阈值取值理由（亮度都是 0..1 的线性亮度，未做 gamma）：
     *
     * 四张对照图都在**同一相机、同一灯光、同一尺寸（`STD_SHOTS` 顺序）**下离屏渲染，
     * 相邻两张之间只改被测的那个参数；地面在自检里统一隐藏，让「暗部」统计只剩球体与背景。
     * 括号里的数字是 526×264 无头窗口（自检目标 256×128）下的实测值，阈值都留了 ≥2 倍余量。
     *
     * - **renderOk**：整幅平均亮度 > 0.05 且亮度 > 0.3 的像素占比 > 2%（实测 0.106 / 0.133）。
     *   本场景（环境光 0.35 + 方向光 0.8）正常渲染时球体明显亮于 0.03 的背景清屏色；
     *   「材质全黑 / 没画出球体」的实现只剩背景（平均亮度 ≈ 0.03），两项都失败。
     * - **roughnessOk / metalnessOk**：只改一个参数，前后帧亮度差 > 0.02 的像素比例 > 3%。
     *   - `diffMetalness`：0.6/0 → 0.6/1 直接改变漫反射与 F0（实测 ≈ 15%）；
     *   - `diffRoughness`：在 **metalness = 1**（金属，F0 = albedo）下比较 0.6 → 0.3 ——
     *     电介质的 F0 只有 0.04，粗糙度只影响一条很窄的高光带（实测整幅差异仅 0.1%，
     *     且两个后端会因逐像素差异而不同）；金属的高光整片都在变（实测 ≈ 10%）。
     *   - 完全忽略该参数的实现恒为 0。
     * - **highlightOk**：同样用**金属**对（metalness = 1，只改粗糙度 0.6 → 0.3），
     *   亮度 > 0.9 的「镜面高光」像素必须**变多**（> 1.3 倍，且绝对值 > 0.01% 像素），
     *   同时整幅平均亮度不能大幅上升（< +0.08）。金属的 F0 = albedo ≈ 0.8，GGX 波瓣变窄时
     *   高光核心从「峰值 0.8 左右」变成「远超 1.0（饱和）」——高粗糙度一侧实测 0 个像素，
     *   低粗糙度一侧实测 0.20%（WebGL2）/ 0.33%（WebGPU）。电介质的 F0 = 0.04 太弱，
     *   高光峰值刚好在 0.9 附近，计数只有几十个像素，会因后端差异翻车（WebGL2 有、WebGPU 没有）。
     *   把 `roughness` 当环境光系数/漫反射倍率的错误实现要么完全没有这种像素，
     *   要么把整幅刷白（平均亮度暴涨）——两个条件都能挡住。
     * - **emissiveOk**：给自发光后，基准图里「暗部」（亮度 < 0.25 且不是背景清屏色）像素的
     *   平均提亮 > 0.05（实测 ≈ 0.55），且整幅平均亮度上升 > 0.005（实测 ≈ 0.08）。自发光只
     *   作用于球体、背景不变，若实现忽略 emissive 则平均提亮恒为 0；要求暗部像素 > 1%
     *   （实测 ≈ 2.2%）只是防止「没有暗部可测」的退化情形。
     * - 自检用**固定光照**（环境光 + 方向光，关掉彩色点光）：点光的彩色高光会饱和成白，
     *   给高光计数引入与粗糙度无关的常量。
     * - `msTotal / msRender / msRead / stepFrames / framesSpent / maxFrameMs` 是诊断字段：
     *   自检被拆成**每帧一步**（4 张图 = 4 帧），实测 WebGL2 94ms / maxFrameMs 17ms、
     *   WebGPU 110ms / 32ms，即没有任何一帧被阻塞（早期版本一次跑完 5 张图会卡住约 6 秒）。
     */

    // ---- 初始化 + 主循环 ---------------------------------------------------
    rebuildGrid();
    resetView();
    updateStats();

    let elapsed = 0;
    return {
      frame(pass, c) {
        frames++;
        if (!frozen && !urlFrozen) {
          elapsed += c.dt;
          // 彩色点光绕场（照亮金属行 → 金属把高光染成灯光颜色）
          for (let i = 0; i < pointPos.length; i++) {
            const a = pointPhase[i]! + elapsed * pointSpeed[i]!;
            pointPos[i]!.set(Math.cos(a) * pointRadius[i]!, pointHeight[i]! + Math.sin(a * 2) * 0.4, Math.sin(a) * pointRadius[i]!);
          }
          applyLights();
          if (state.autoOrbit) {
            cam.yaw += c.dt * 0.12;
            cam.update();
          }
        }
        drawScene(pass);

        hudFrames++;
        const now = performance.now();
        if (now - hudLast >= 500) {
          fps = Math.round((hudFrames * 1000) / Math.max(1, now - hudLast));
          hudFrames = 0;
          hudLast = now;
          updateStats();
        }

        // 看门狗：自检万一卡住（例如回读一直不返回），兜底恢复状态，别让页面一直冻结
        if (testIndex >= 0 && performance.now() - testStart > 15000) {
          failSelfTest(new Error("自检超时（离屏回读未返回）"));
        }

        if (selfTest && !tested && frames === 30) {
          tested = true;
          // 自检拆成「每帧一步」由 rAF 推进：这一步在下一帧的画布 pass 打开之前执行
          beginSelfTest();
          requestAnimationFrame(stepSelfTest);
        }
      },
    };
  },
});
