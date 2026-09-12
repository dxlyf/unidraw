/**
 * 验证页 · 2D 合批的「索引缓冲 vs 文本缓冲」回归
 *
 * 背景（WebGL2 专属 bug，已修）：
 *   `GLBuffer.write()` 直接 `bindBuffer(ELEMENT_ARRAY_BUFFER, …)`，而该绑定是 **VAO 状态**。
 *   框架的 VAO 是缓存复用的，于是「先写彩色图形（flat）的索引、再写文本（glyph）的索引」
 *   会把 flat 的 VAO 指到文本的索引缓冲区上 → 后续 drawElements 读到越界索引（恒为 0）
 *   → 三角形退化 → **整批彩色图形凭空消失**（WebGPU 没有 VAO，不受影响）。
 *
 * 本页按真实绘制顺序构造最小场景：
 *   A 红块（文本之前）→ 文本 → clipRect 内的绿块 → restore → 蓝块（文本之后）
 * 修复前：WebGL2 只有 A（以及被文本覆盖前的内容）可见；修复后两个后端逐像素一致。
 *
 * 用法：`npm run build:verify` 后打开 `/_verify-2d-clip/index.html?backend=webgl2|webgpu`
 */
import { Renderer } from "../../src/render/Renderer.js";
import { Canvas2D } from "../../src/render2d/index.js";

const params = new URLSearchParams(location.search);

const canvas = document.createElement("canvas");
canvas.width = 400;
canvas.height = 200;
canvas.style.width = "400px";
canvas.style.height = "200px";
canvas.style.display = "block";
document.body.style.margin = "0";
document.body.style.background = "#000000";
document.body.appendChild(canvas);

const renderer = await Renderer.create(canvas, {
  backend: (params.get("backend") ?? "auto") as "auto" | "webgpu" | "webgl2" | "mock",
  depth: false,
});

const c2d = new Canvas2D(renderer.device);
const w = canvas.width;
const h = canvas.height;

// 自动化探针钩子（与 examples/common/demo.ts 保持一致）
(globalThis as Record<string, unknown>).__unidraw = {
  get renderer() {
    return renderer;
  },
  get canvas() {
    return canvas;
  },
  get status() {
    return {
      backend: renderer.device.kind,
      name: renderer.device.info.name,
      err: "",
      fps: "",
      size: [w, h],
      frames: 1,
    };
  },
};

const frame = (): void => {
  const pass = renderer.beginFrame();
  c2d.setViewportSize(w, h);
  c2d.begin();

  // A：文本之前的彩色图形
  c2d.fillStyle = "#ff0000";
  c2d.fillRect(10, 10, 100, 40);

  // 文本（glyph 纹理 + 独立的顶点/索引缓冲）：修复前它会「踩坏」flat 的索引绑定
  c2d.fillStyle = "#ffffff";
  c2d.font = "12px system-ui, sans-serif";
  c2d.fillText("HELLO TEXT", 10, 100);

  // B：裁剪内的彩色图形（同时覆盖 scissor 路径）
  c2d.save();
  c2d.clipRect(150, 60, 120, 60);
  c2d.fillStyle = "#00ff00";
  c2d.fillRect(100, 40, 180, 100);
  c2d.restore();

  // C：文本之后的彩色图形（不被裁剪）
  c2d.fillStyle = "#0000ff";
  c2d.fillRect(10, 150, 100, 40);

  // 不传投影 = 用内置的**网页坐标系**（原点左上、y 向下、1 单位 = 1 逻辑像素）
  c2d.flush(pass);
  renderer.endFrame();
  requestAnimationFrame(frame);
};

requestAnimationFrame(frame);
