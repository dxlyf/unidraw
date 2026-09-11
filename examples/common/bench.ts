/**
 * 性能测量引导（bench harness）。
 *
 * 约定：
 * - 每个“档位”（preset）是一个独立场景，进入档位后热身后测量窗口平均帧耗时；
 * - 默认**不自动循环**：用右上角面板（lil-gui）点击档位，或 ←/→ 切换；空格开/关循环；
 * - 全程真实渲染（同一套 WebGL2/WebGPU 代码），测量的是完整帧（含提交）。
 *
 * 用法：
 *   bootBench({
 *     title: "…",
 *     presets: [{ name: "1k draws", create(ctx) { return scene; } }, …],
 *     pixelScale: 1,          // 固定 1 保证各档位可对比（可选，默认 1）
 *     autoCycleMs: 2600,      // 每档停留时间（含热身），可选
 *   });
 */

import { Renderer } from "../../src/render/Renderer.js";
import { Camera } from "../../src/render/Camera.js";
import type { Device } from "../../src/device/Device.js";
import type { RenderPassEncoder } from "../../src/command/encoder.js";
import { degToRad } from "../../src/math/mmath.js";
import { attachOrbitControls } from "./demo.js";
import { createGui } from "./gui.js";

export interface BenchContext {
  renderer: Renderer;
  device: Device;
  camera: Camera;
  width: number;
  height: number;
}

/** 一个渲染场景：draw 里画完本帧内容；status() 返回当前档位统计。 */
export interface BenchScene {
  draw(pass: RenderPassEncoder, timeSec: number, ctx: BenchContext): void;
  /** 每帧追加显示的统计文本（如实例数/三角形数）；`avgMs` 为当前测量窗口的平均帧耗时 */
  status?(avgMs: number): string;
}

export interface BenchPreset {
  name: string;
  create(ctx: BenchContext): BenchScene;
}

export interface BenchOptions {
  title: string;
  presets: BenchPreset[];
  /** 固定渲染分辨率系数（默认 1：忽略 devicePixelRatio，便于横评） */
  pixelScale?: number;
  /** 每档停留毫秒（仅自动循环时有效；默认 3000） */
  dwellMs?: number;
  /**
   * 是否自动循环档位（默认 **false**：停在当前档位，用户点击档位或用 ←/→ 切换）。
   * URL 参数 `?cycle=1` 可临时打开自动循环。
   */
  autoCycle?: boolean;
}

const RING = 90; // 测量窗口帧数

function backendFromUrl(): string {
  try {
    const v = new URLSearchParams(location.search).get("backend");
    if (v && ["webgpu", "webgl2", "mock", "auto"].includes(v)) return v;
  } catch {
    /* ignore */
  }
  return "auto";
}

function pixelScaleFromUrl(fallback: number): number {
  try {
    const v = Number(new URLSearchParams(location.search).get("scale"));
    if (v >= 1 && v <= 3) return v;
  } catch {
    /* ignore */
  }
  return fallback;
}

function dwellFromUrl(fallback: number): number {
  try {
    const v = Number(new URLSearchParams(location.search).get("dwell"));
    if (v >= 200 && v <= 30000) return v;
  } catch {
    /* ignore */
  }
  return fallback;
}

export async function bootBench(options: BenchOptions): Promise<BenchContext> {
  const urlParams = new URLSearchParams(location.search);
  const pixelScaleDefault = pixelScaleFromUrl(options.pixelScale ?? 1);
  const dwellDefault = dwellFromUrl(options.dwellMs ?? 3000);

  // ---- DOM ---------------------------------------------------------------
  const canvas = document.createElement("canvas");
  canvas.id = "canvas";
  document.body.appendChild(canvas);
  const style = document.createElement("style");
  style.textContent = `
    html, body { margin:0; height:100%; overflow:hidden; background:#0b0c10; font-family: system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
    #canvas { width:100vw; height:100vh; display:block; touch-action:none; }
    .hud { position:fixed; left:14px; top:12px; color:#d7d9e0; font-size:13px; line-height:1.7; z-index:10; pointer-events:none; user-select:none; text-shadow:0 1px 3px rgba(0,0,0,.8); }
    .hud b { color:#fff; }
    .chip { display:inline-block; padding:1px 8px; border-radius:10px; background:#1d2130; border:1px solid #343a4e; margin-left:6px; font-size:11px; }
    .err { color:#ff8f9e; white-space:pre-wrap; max-width:70vw; }
    .hud .big { margin-top:6px; font-variant-numeric: tabular-nums; }
    .hud .big .v { font-size:22px; color:#6fe3a1; }
    .hud .status { margin-top:2px; color:#9aa0b5; font-variant-numeric: tabular-nums; white-space: pre; }
  `;
  document.head.appendChild(style);

  const hud = document.createElement("div");
  hud.className = "hud";
  hud.innerHTML =
    `<b>${options.title}</b><span class="chip" id="chip"></span>` +
    `<div class="big">帧耗时 <span class="v" id="big">—</span></div>` +
    `<div class="status" id="status"></div>` +
    `<div id="err" class="err"></div>`;
  document.body.appendChild(hud);
  const errEl = hud.querySelector("#err")!;
  const chip = hud.querySelector("#chip")!;
  const bigEl = hud.querySelector("#big")!;
  const statusEl = hud.querySelector("#status")!;

  window.addEventListener("error", (e) => (errEl.textContent = `[error] ${e.message}`));
  window.addEventListener("unhandledrejection", (e) => (errEl.textContent = `[promise] ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`));

  // ---- 设备 / 相机 -------------------------------------------------------
  // 性能档位示例显式关掉 MSAA：它们测的是 draw call / 三角形吞吐，
  // 4x MSAA 会额外引入 4 倍填充率与一次全屏呈现，掩盖被测项（观感对比请用其它示例）。
  const renderer = await Renderer.create(canvas, {
    backend: backendFromUrl() as "auto" | "webgpu" | "webgl2" | "mock",
    msaa: 1,
  });
  chip.textContent = renderer.device.kind + " · " + renderer.device.info.name;

  // 自动化探针钩子（无副作用）
  let probeFrames = 0;
  (globalThis as Record<string, unknown>).__unidraw = {
    get status() {
      return {
        backend: renderer.device.kind,
        name: renderer.device.info.name,
        err: errEl.textContent ?? "",
        fps: bigEl.textContent,
        size: [canvas.width, canvas.height],
        frames: probeFrames,
      };
    },
  };

  const camera = new Camera();
  camera.setPerspective(degToRad(60), 1, 0.1, 400);
  camera.distance = 10;
  camera.update();
  attachOrbitControls(camera, canvas);

  const ctx: BenchContext = { renderer, device: renderer.device, camera, width: canvas.width, height: canvas.height };

  // ---- 档位管理 -----------------------------------------------------------
  const scenes: (BenchScene | null)[] = options.presets.map(() => null);

  let ring: number[] = [];
  let warmFrames = 0;
  let dwellStart = performance.now();
  const autoFromUrl = (() => {
    const v = urlParams.get("cycle");
    if (v === "1" || v === "true") return true;
    if (v === "0" || v === "false") return false;
    return null;
  })();
  const state = {
    autoCycle: autoFromUrl ?? options.autoCycle ?? false,
    dwellMs: dwellDefault,
    pixelScale: pixelScaleDefault,
    spin: true,
  };
  let idx = 0;
  let scene: BenchScene;

  function loadScene(index: number): BenchScene {
    if (!scenes[index]) {
      try {
        scenes[index] = options.presets[index]!.create(ctx);
      } catch (e) {
        errEl.textContent = e instanceof Error ? e.stack ?? e.message : String(e);
        scenes[index] = emptyScene();
      }
    }
    ring.length = 0;
    warmFrames = 0;
    dwellStart = performance.now();
    return scenes[index]!;
  }

  function emptyScene(): BenchScene {
    return { draw() {} };
  }

  function activate(index: number): void {
    idx = Math.max(0, Math.min(options.presets.length - 1, index));
    scene = loadScene(idx);
    refreshLabels();
  }

  /** URL 参数 `?tier=N`（0 起）或 `?draws=6000`（按档位名匹配数字）指定初始档位 */
  const initialIndex = (() => {
    const tier = urlParams.get("tier");
    if (tier !== null && Number.isFinite(Number(tier))) return Number(tier);
    const draws = urlParams.get("draws");
    if (draws !== null) {
      const want = Number(draws.replace(/[^0-9]/g, ""));
      const found = options.presets.findIndex((p) => Number(p.name.replace(/[^0-9]/g, "")) === want);
      if (found >= 0) return found;
    }
    return 0;
  })();

  scene = loadScene(initialIndex);
  idx = initialIndex;

  // ---- 参数面板（lil-gui） ------------------------------------------------
  const gui = createGui({ title: "性能测量", params: urlParams });
  const tierFolder = gui.addFolder("档位");
  /** 每档一个按钮：名字里带测量结果（激活的档位加 ●） */
  const tierControllers = options.presets.map((preset, i) =>
    tierFolder
      .add(
        {
          [preset.name]: () => {
            state.autoCycle = false;
            syncPanel();
            activate(i);
          },
        },
        preset.name,
      )
      .name(preset.name),
  );

  const measureFolder = gui.addFolder("测量");
  measureFolder.add(state, "autoCycle").name("自动循环档位").onChange(syncPanel);
  measureFolder.add(state, "dwellMs", 500, 10000, 100).name("每档停留 (ms)");
  measureFolder.add(state, "pixelScale", { "1x（默认，可横评）": 1, "1.5x": 1.5, "2x": 2 }).name("渲染分辨率");
  measureFolder.add(state, "spin").name("相机自动旋转");
  measureFolder
    .add({ 重测当前档位: () => activate(idx) }, "重测当前档位")
    .name("重测当前档位");
  measureFolder
    .add(
      {
        下一档位: () => {
          state.autoCycle = false;
          syncPanel();
          activate((idx + 1) % options.presets.length);
        },
      },
      "下一档位",
    )
    .name("下一档位");

  const monitor = { 帧耗时: "—", FPS: "—", 统计: "" };
  const monitorFolder = gui.addFolder("实时监看");
  const msCtrl = monitorFolder.add(monitor, "帧耗时").name("帧耗时").disable();
  const fpsCtrl = monitorFolder.add(monitor, "FPS").name("FPS").disable();
  const statsCtrl = monitorFolder.add(monitor, "统计").name("场景统计").disable();
  monitorFolder.open();

  function syncPanel(): void {
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  function refreshLabels(): void {
    tierControllers.forEach((ctrl, i) => {
      const base = options.presets[i]!.name;
      const measured = measuredMs[i];
      ctrl.name(`${i === idx ? "● " : ""}${base}${measured !== undefined ? ` — ${measured.toFixed(1)} ms` : ""}`);
      ctrl.updateDisplay();
    });
  }

  /** 每档最近一次的测量结果（面板按钮上显示） */
  const measuredMs: (number | undefined)[] = options.presets.map(() => undefined);

  function frameStats(): number[] {
    return ring.length >= 3 ? ring.slice(-Math.min(RING, ring.length)) : [];
  }

  // ---- 主循环（含测量） ---------------------------------------------------
  let prev = performance.now();

  const loop = (now: number) => {
    const dtMs = now - prev;
    prev = now;

    try {
      renderer.resizeToDisplaySize(state.pixelScale);
      ctx.width = canvas.width;
      ctx.height = canvas.height;
      camera.aspect = canvas.width / Math.max(1, canvas.height);
      if (state.spin) camera.yaw += 0.11 * Math.min(dtMs / 1000, 0.05);
      camera.update();

      const timeSec = now / 1000;
      const pass = renderer.beginFrame();
      scene.draw(pass, timeSec, ctx);
      renderer.endFrame();

      // 测量：跳过档位切换后的热身帧
      if (warmFrames < 12) warmFrames++;
      else if (ring.length < RING) ring.push(dtMs);
    } catch (e) {
      errEl.textContent = e instanceof Error ? e.stack ?? e.message : String(e);
    }

    // 结果展示
    const s = frameStats();
    let avgMs = 0;
    if (s.length > 0) {
      avgMs = s.reduce((a, b) => a + b, 0) / s.length;
      bigEl.textContent = `${avgMs.toFixed(2)} ms · ${(1000 / avgMs).toFixed(0)} fps`;
      measuredMs[idx] = avgMs;
      monitor.帧耗时 = avgMs.toFixed(2) + " ms";
      monitor.FPS = (1000 / avgMs).toFixed(0);
      msCtrl.updateDisplay();
      fpsCtrl.updateDisplay();
      refreshLabels();
    }
    const statusText = scene.status ? scene.status(avgMs) : "";
    statusEl.textContent = statusText;
    if (monitor.统计 !== statusText) {
      monitor.统计 = statusText;
      statsCtrl.updateDisplay();
    }

    // 档位切换
    if (state.autoCycle && now - dwellStart >= state.dwellMs) {
      const next = (idx + 1) % options.presets.length;
      activate(next);
    }
    probeFrames++;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  syncPanel();
  refreshLabels();

  // 键盘快捷键（与面板等价）
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      state.autoCycle = !state.autoCycle;
      if (state.autoCycle) dwellStart = performance.now();
      syncPanel();
    } else if (e.code === "ArrowRight" || e.code === "ArrowLeft") {
      e.preventDefault();
      state.autoCycle = false;
      const dir = e.code === "ArrowRight" ? 1 : -1;
      activate((idx + dir + options.presets.length) % options.presets.length);
      syncPanel();
    } else if (e.code === "KeyR") {
      // 重测当前档位（清空测量窗口重新热身）
      activate(idx);
    }
  });

  return ctx;
}
