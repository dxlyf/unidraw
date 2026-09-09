/**
 * 性能测量引导（bench harness）。
 *
 * 约定：
 * - 每个“档位”（preset）是一个独立场景，进入档位后热身后测量窗口平均帧耗时；
 * - 默认自动循环所有档位，点击档位可手动停留在该档；空格暂停/恢复自动循环；
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
  /** 每帧追加显示的统计文本（如实例数/三角形数），可空字符串 */
  status?(): string;
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
  /** 每档停留毫秒（含热身；默认 3000） */
  dwellMs?: number;
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

export async function bootBench(options: BenchOptions): Promise<BenchContext> {
  const pixelScale = pixelScaleFromUrl(options.pixelScale ?? 1);
  const dwellMs = options.dwellMs ?? 3000;

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
    #panel { position:fixed; right:14px; top:12px; width:230px; z-index:10; font-size:12px; color:#c9cbd4; background:rgba(18,20,28,.72); border:1px solid #2b3040; border-radius:10px; padding:10px 12px; backdrop-filter: blur(4px); }
    #panel .title { color:#fff; margin-bottom:6px; font-weight:600; }
    #panel button { display:flex; justify-content:space-between; gap:8px; width:100%; text-align:left; margin:3px 0; padding:4px 8px; border-radius:7px; border:1px solid transparent; background:#22263a; color:#d7d9e0; cursor:pointer; font:inherit; }
    #panel button.active { background:#2d4470; border-color:#6b96ff; }
    #panel button .r { color:#8fc7ff; font-variant-numeric: tabular-nums; }
    #panel .big { margin-top:8px; font-variant-numeric: tabular-nums; }
    #panel .big .v { font-size:22px; color:#6fe3a1; }
    #panel .hint { margin-top:8px; color:#6b7185; font-size:11px; }
    #panel .status { margin-top:4px; color:#9aa0b5; font-variant-numeric: tabular-nums; white-space: pre; }
  `;
  document.head.appendChild(style);

  const hud = document.createElement("div");
  hud.className = "hud";
  hud.innerHTML = `<b>${options.title}</b><span class="chip" id="chip"></span><br/><span id="err" class="err"></span>`;
  document.body.appendChild(hud);
  const errEl = hud.querySelector("#err")!;
  const chip = hud.querySelector("#chip")!;

  const panel = document.createElement("div");
  panel.id = "panel";
  panel.innerHTML = `
    <div class="title">测量结果</div>
    <div id="rows"></div>
    <div class="big">帧耗时 <span class="v" id="big"></span></div>
    <div class="status" id="status"></div>
    <div class="hint">自动循环档位中 · 点击档位手动停留 · 空格：暂停/继续</div>`;
  document.body.appendChild(panel);
  const rowsEl = panel.querySelector("#rows")!;
  const bigEl = panel.querySelector("#big")!;
  const statusEl = panel.querySelector("#status")!;

  window.addEventListener("error", (e) => (errEl.textContent = `[error] ${e.message}`));
  window.addEventListener("unhandledrejection", (e) => (errEl.textContent = `[promise] ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`));

  // ---- 设备 / 相机 -------------------------------------------------------
  const renderer = await Renderer.create(canvas, { backend: backendFromUrl() as "auto" | "webgpu" | "webgl2" | "mock" });
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
  let auto = true;
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
    idx = index;
    scene = loadScene(index);
    refreshRows();
  }

  scene = loadScene(0);

  // 档位按钮
  const buttons: HTMLButtonElement[] = [];
  options.presets.forEach((p, i) => {
    const b = document.createElement("button");
    b.dataset.i = String(i);
    b.innerHTML = `<span>${p.name}</span><span class="r" id="r${i}">—</span>`;
    b.addEventListener("click", () => {
      auto = false;
      activate(i);
    });
    rowsEl.appendChild(b);
    buttons.push(b);
  });

  function refreshRows(): void {
    buttons.forEach((b, i) => b.classList.toggle("active", i === idx));
  }

  function frameStats(): number[] {
    return ring.length >= 3 ? ring.slice(-Math.min(RING, ring.length)) : [];
  }

  // ---- 主循环（含测量） ---------------------------------------------------
  let prev = performance.now();

  const loop = (now: number) => {
    const dtMs = now - prev;
    prev = now;

    try {
      renderer.resizeToDisplaySize(pixelScale);
      ctx.width = canvas.width;
      ctx.height = canvas.height;
      camera.aspect = canvas.width / Math.max(1, canvas.height);
      if (auto) camera.yaw += 0.11 * Math.min(dtMs / 1000, 0.05);
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
    if (s.length > 0) {
      const avgMs = s.reduce((a, b) => a + b, 0) / s.length;
      bigEl.textContent = `${avgMs.toFixed(2)} ms · ${(1000 / avgMs).toFixed(0)} fps`;
      const rEl = document.querySelector(`#r${idx}`)!;
      rEl.textContent = `${avgMs.toFixed(1)} ms`;
    }
    statusEl.textContent = scene.status ? scene.status() : "";

    // 档位切换
    if (auto && now - dwellStart >= dwellMs) {
      const next = (idx + 1) % options.presets.length;
      activate(next);
    }
    probeFrames++;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // 空格切换自动/手动
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      auto = !auto;
      if (auto) dwellStart = performance.now();
    }
  });

  return ctx;
}
