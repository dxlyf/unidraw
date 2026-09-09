/**
 * 示例公共引导：全屏 canvas + Renderer + 轨道相机 + FPS + 后端切换。
 * 用 URL 参数选择后端：?backend=webgpu | webgl2 | auto
 */

import { Renderer } from "../../src/render/Renderer.js";
import { Camera } from "../../src/render/Camera.js";
import { Color } from "../../src/math/color.js";
import { degToRad, clamp } from "../../src/math/mmath.js";
import type { RenderPassEncoder } from "../../src/command/encoder.js";
import type { Device } from "../../src/device/Device.js";

export interface DemoContext {
  renderer: Renderer;
  device: Device;
  camera: Camera;
  time: number;
  dt: number;
  width: number;
  height: number;
}

export interface DemoHooks {
  title: string;
  /** 初始化（同步）；返回每帧回调。若需异步资源请先 await 再调用 bootDemo。 */
  run(ctx: DemoContext): { frame(pass: RenderPassEncoder, ctx: DemoContext): void };
}

export interface DemoOptions {
  /**
   * 帧缓冲是否带深度附件（默认 true）。
   * 注意（WebGPU 语义）：pass 带深度附件时，参与绘制的管线都必须声明
   * 匹配的 depthStencil；纯 2D 示例请设 false。
   */
  depth?: boolean;
}

function backendFromUrl(): string {
  try {
    const v = new URLSearchParams(location.search).get("backend");
    if (v && ["webgpu", "webgl2", "mock", "auto"].includes(v)) return v;
  } catch {
    /* ignore */
  }
  return "auto";
}

function depthFromUrl(): boolean {
  try {
    const v = new URLSearchParams(location.search).get("depth");
    if (v === "0" || v === "false") return false;
  } catch {
    /* ignore */
  }
  return true;
}

export function attachOrbitControls(camera: Camera, canvas: HTMLCanvasElement): { dispose(): void } {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    camera.yaw -= dx * 0.005;
    camera.pitch = clamp(camera.pitch - dy * 0.005, degToRad(-89), degToRad(89));
    camera.update();
  };
  const onUp = (e: PointerEvent) => {
    dragging = false;
    canvas.releasePointerCapture(e.pointerId);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    camera.distance = clamp(camera.distance * (1 + e.deltaY * 0.001), 0.5, 200);
    camera.update();
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  return {
    dispose() {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
    },
  };
}

export async function bootDemo(hooks: DemoHooks, options: DemoOptions = {}): Promise<DemoContext> {
  const canvas = document.createElement("canvas");
  canvas.id = "canvas";
  document.body.appendChild(canvas);

  const style = document.createElement("style");
  style.textContent = `
    html, body { margin:0; height:100%; overflow:hidden; background:#0b0c10; font-family: system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
    #canvas { width:100vw; height:100vh; display:block; touch-action:none; }
    .hud { position:fixed; left:14px; top:12px; color:#d7d9e0; font-size:13px; line-height:1.7; z-index:10;
           text-shadow:0 1px 3px rgba(0,0,0,.8); pointer-events:none; user-select:none; }
    .hud b { color:#fff; }
    .hud .backend { display:inline-block; padding:1px 8px; border-radius:10px; background:#1d2130; border:1px solid #343a4e; margin-left:6px; font-size:11px; }
    .hud .err { color:#ff8f9e; white-space:pre-wrap; max-width:70vw; }
    .hint { position:fixed; right:12px; bottom:10px; color:#6b7185; font-size:11px; pointer-events:none; z-index:10; }
  `;
  document.head.appendChild(style);

  const hud = document.createElement("div");
  hud.className = "hud";
  hud.innerHTML = `<b>${hooks.title}</b><span class="backend" id="backend"></span><br/><span id="fps"></span><div class="err" id="err"></div>`;
  document.body.appendChild(hud);
  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "拖拽旋转 · 滚轮缩放 · URL 追加 ?backend=webgpu|webgl2 切换后端";
  document.body.appendChild(hint);

  const fpsEl = hud.querySelector("#fps")!;
  const errEl = hud.querySelector("#err")!;
  const backendEl = hud.querySelector("#backend")!;

  window.addEventListener("error", (e) => {
    errEl.textContent = `[error] ${e.message}`;
  });
  window.addEventListener("unhandledrejection", (e) => {
    errEl.textContent = `[promise] ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`;
  });

  const depthRequested = options.depth ?? true;
  const renderer = await Renderer.create(canvas, {
    backend: backendFromUrl() as "auto" | "webgpu" | "webgl2" | "mock",
    depth: depthFromUrl() && depthRequested,
  });
  backendEl.textContent = renderer.device.kind;
  backendEl.textContent += " · " + renderer.device.info.name;
  if (renderer.device.kind === "webgpu") {
    hint.textContent = "WebGPU 后端：渲染为空时请查看控制台（已打印 WGSL 编译诊断/校验错误）· 拖拽旋转 · ?backend=webgl2 可对比";
  }

  // 自动化探针钩子（无副作用）
  let probeFrames = 0;
  (globalThis as Record<string, unknown>).__unidraw = {
    get status() {
      return {
        backend: renderer.device.kind,
        name: renderer.device.info.name,
        err: errEl.textContent ?? "",
        fps: fpsEl.textContent,
        size: [canvas.width, canvas.height],
        frames: probeFrames,
      };
    },
  };

  const camera = new Camera();
  camera.setPerspective(degToRad(60), 1, 0.1, 200);
  camera.distance = 6;
  camera.update();

  let disposed = false;
  attachOrbitControls(camera, canvas);

  const ctx: DemoContext = {
    renderer,
    device: renderer.device,
    camera,
    time: 0,
    dt: 0,
    width: canvas.width,
    height: canvas.height,
  };
  let frameFn: ((pass: RenderPassEncoder, ctx: DemoContext) => void) | null = null;
  try {
    frameFn = hooks.run(ctx).frame;
  } catch (e) {
    errEl.textContent = e instanceof Error ? e.stack ?? e.message : String(e);
  }

  let frames = 0;
  let lastFpsTime = performance.now();
  let prev = performance.now();

  const loop = (now: number) => {
    if (disposed) return;
    const dt = Math.min((now - prev) / 1000, 0.1);
    prev = now;
    try {
      const changed = renderer.resizeToDisplaySize(2);
      if (changed) {
        camera.aspect = canvas.width / Math.max(1, canvas.height);
        camera.update();
      }
      ctx.time = now / 1000;
      ctx.dt = dt;
      ctx.width = canvas.width;
      ctx.height = canvas.height;

      const pass = renderer.beginFrame();
      try {
        frameFn?.(pass, ctx);
      } catch (e) {
        errEl.textContent = e instanceof Error ? e.stack ?? e.message : String(e);
      }
      renderer.endFrame();
    } catch (e) {
      // 任何一帧崩溃都不中断动画循环，便于看到持续错误信息
      errEl.textContent = e instanceof Error ? e.stack ?? e.message : String(e);
    }

    frames++;
    probeFrames++;
    if (now - lastFpsTime >= 500) {
      fpsEl.textContent = `fps: ${Math.round((frames * 1000) / (now - lastFpsTime))}`;
      frames = 0;
      lastFpsTime = now;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return ctx;
}

export { Color };
