/**
 * 验证页 · 与**原生 Canvas2D** 的逐像素对照（2D 渲染质量的量化依据）
 *
 * 做法：同一段绘制脚本喂给两种实现 ——
 * - 原生：`CanvasRenderingContext2D`（浏览器的 Skia/Canvas2D 实现，抗锯齿是解析覆盖率）；
 * - 本框架：`Canvas2D` + 与 `Renderer` 默认一致的 4x MSAA 离屏目标。
 * 两边的像素在**预乘空间**逐点比较（预乘才是最终显示值），按区域给出指标，
 * 便于定位「哪一类图元还不够像」。
 *
 * 用法：`npm run build:verify` → `/_verify-2d-parity/index.html?backend=webgl2|webgpu[&msaa=4]`
 * 页面左侧是原生结果、右侧是本框架结果，正下方是每次运行的指标。
 */
import { createDevice } from "../../src/device/createDevice.js";
import { RenderTarget } from "../../src/render/RenderTarget.js";
import { Canvas2D, LinearGradient, RadialGradient } from "../../src/render2d/index.js";
import { Mat4 } from "../../src/math/mat4.js";

const W = 480;
const H = 270;
const params = new URLSearchParams(location.search);
const SAMPLES = Math.max(1, Math.floor(Number(params.get("msaa") ?? 4)));

// ---------------------------------------------------------------------------
// 场景：只使用「原生与框架都支持」的 API，两边跑同一份代码
// ---------------------------------------------------------------------------

interface GradientLike {
  addColorStop(offset: number, color: string): unknown;
}

interface SceneCtx {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  globalAlpha: number;
  font: string;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void;
  quadraticCurveTo(a: number, b: number, c: number, d: number): void;
  arc(x: number, y: number, r: number, s: number, e: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, s: number, e: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  roundRect(x: number, y: number, w: number, h: number, r: number | number[]): void;
  closePath(): void;
  /** 填充规则（`nonzero` / `evenodd`） */
  fill(rule?: string): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(a: number): void;
  scale(x: number, y: number): void;
  /** 框架侧用 clipRect；原生侧由调用点改成 rect()+clip() */
  clipRect?(x: number, y: number, w: number, h: number): void;
}

interface GradientFactory {
  linear(x0: number, y0: number, x1: number, y1: number): GradientLike;
  radial(cx: number, cy: number, r: number): GradientLike;
  clip(c: SceneCtx, x: number, y: number, w: number, h: number): void;
}

const FONT = 'system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

/** 每个区域用来定位「哪类图元不够像」 */
const REGIONS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: "曲线粗描边", x: 20, y: 55, w: 230, h: 165 },
  { name: "细线", x: 14, y: 22, w: 150, h: 44 },
  { name: "半透明叠加", x: 52, y: 52, w: 126, h: 126 },
  { name: "线性渐变", x: 16, y: 232, w: 288, h: 34 },
  { name: "径向渐变", x: 364, y: 94, w: 132, h: 132 },
  { name: "圆角矩形", x: 326, y: 206, w: 138, h: 52 },
  { name: "星形(凹多边形)", x: 328, y: 18, w: 96, h: 96 },
  { name: "文字", x: 18, y: 104, w: 240, h: 44 },
  { name: "圆/椭圆", x: 258, y: 148, w: 190, h: 84 },
];

/**
 * 填充规则场景：专门验证「多子路径 / 自相交路径」的填充区域。
 *
 * - 重叠子路径（同一条路径里两个相交矩形）→ 只覆盖一次，半透明不该有深色缝；
 * - 内环挖洞（evenodd / 反向绕序的 nonzero）→ 中间要是空的；
 * - 一笔画五角星（自相交）→ nonzero 中心实心、evenodd 中心是五边形空洞。
 */
const FILL_REGIONS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: "重叠子路径", x: 12, y: 12, w: 148, h: 148 },
  { name: "evenodd 挖洞", x: 170, y: 12, w: 148, h: 148 },
  { name: "nonzero 挖洞", x: 328, y: 12, w: 144, h: 148 },
  { name: "五星 nonzero", x: 12, y: 166, w: 148, h: 96 },
  { name: "五星 evenodd", x: 170, y: 166, w: 148, h: 96 },
  { name: "多轮廓自交", x: 328, y: 166, w: 144, h: 96 },
];

/** 五角星：一笔画的**自相交**路径（5 个顶点按隔点相连） */
function starPath(c: SceneCtx, cx: number, cy: number, r: number): void {
  c.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.closePath();
}

function drawFillRules(c: SceneCtx): void {
  c.fillStyle = "#101826";
  c.fillRect(0, 0, W, H);

  // 1) 一条路径里两个重叠矩形（半透明）：应当只覆盖一次
  c.globalAlpha = 0.55;
  c.fillStyle = "#35d7ee";
  c.beginPath();
  c.rect(24, 24, 88, 88);
  c.rect(64, 64, 88, 88);
  c.fill();
  c.globalAlpha = 1;

  // 2) evenodd 挖洞：外框 + 内框（同向）
  c.fillStyle = "#f5d02e";
  c.beginPath();
  c.rect(186, 24, 116, 116);
  c.rect(214, 52, 60, 60);
  c.fill("evenodd");

  // 3) nonzero 挖洞：内框反向绕序
  c.fillStyle = "#ff9a3d";
  c.beginPath();
  c.rect(344, 24, 112, 112);
  c.moveTo(370, 50);
  c.lineTo(370, 110);
  c.lineTo(430, 110);
  c.lineTo(430, 50);
  c.closePath();
  c.fill();

  // 4) 五星：nonzero（中心实心）
  c.fillStyle = "#ff5c7a";
  starPath(c, 76, 216, 44);
  c.fill();

  // 5) 五星：evenodd（中心留五边形空洞）
  c.fillStyle = "#5aa0ff";
  starPath(c, 234, 216, 44);
  c.fill("evenodd");

  // 6) 多个子路径自相交（两个重叠矩形 + 一个三角），nonzero
  c.fillStyle = "#3dd68c";
  c.beginPath();
  c.rect(352, 176, 72, 72);
  c.rect(384, 200, 64, 60);
  c.moveTo(352, 260);
  c.lineTo(400, 168);
  c.lineTo(444, 260);
  c.closePath();
  c.fill();
}

function drawScene(c: SceneCtx, g: GradientFactory): void {
  // 背景：竖向线性渐变（整幅不透明，两侧都从透明画到不透明）
  const bg = g.linear(0, 0, 0, H);
  bg.addColorStop(0, "#101826");
  bg.addColorStop(1, "#1d2740");
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);

  // 1) 粗贝塞尔描边（曲线平滑度 / 宽描边）
  c.strokeStyle = "#ff5c7a";
  c.lineWidth = 9;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.beginPath();
  c.moveTo(34, 196);
  c.bezierCurveTo(84, 62, 176, 236, 238, 116);
  c.stroke();

  // 2) 1.2px 细线（细描边保真度：最容易看出锯齿）
  c.strokeStyle = "#f2f5ff";
  c.lineWidth = 1.2;
  c.lineCap = "butt";
  c.beginPath();
  c.moveTo(20, 32);
  c.lineTo(158, 58);
  c.stroke();

  // 3) 半透明叠加（同一路径/相邻图元的重叠处不应出现二次混合的深色缝）
  c.globalAlpha = 0.5;
  c.fillStyle = "#ffd54a";
  c.fillRect(60, 60, 72, 72);
  c.fillStyle = "#4ce08a";
  c.fillRect(104, 102, 72, 72);
  c.globalAlpha = 1;

  // 4) 多段线性渐变（逐像素求值 vs 顶点采样的差异在 stop 边界处最明显）
  const lg = g.linear(20, 240, 300, 240);
  lg.addColorStop(0, "#ff0000");
  lg.addColorStop(0.25, "#ffd000");
  lg.addColorStop(0.5, "#3dd68c");
  lg.addColorStop(0.75, "#35a0ff");
  lg.addColorStop(1, "#b07cff");
  c.fillStyle = lg;
  c.fillRect(20, 236, 280, 26);

  // 5) 径向渐变（框架侧是按顶点采样 + 细分近似的，最容易看出差别）
  const rg = g.radial(430, 160, 58);
  rg.addColorStop(0, "#ffffff");
  rg.addColorStop(0.55, "#ff9a3d");
  rg.addColorStop(1, "#5a1f00");
  c.fillStyle = rg;
  c.beginPath();
  c.arc(430, 160, 58, 0, Math.PI * 2);
  c.fill();

  // 6) 圆角矩形（四角不同半径）
  c.fillStyle = "#5aa0ff";
  c.beginPath();
  c.roundRect(330, 210, 130, 44, [22, 6, 22, 6]);
  c.fill();

  // 7) 星形（凹多边形填充，耳切）
  c.fillStyle = "#f5d02e";
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 40 : 18;
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const x = 376 + Math.cos(a) * r;
    const y = 66 + Math.sin(a) * r;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.closePath();
  c.fill();

  // 8) 文字（两号字：字形栅格化 + 定位）
  c.fillStyle = "#f2f5ff";
  c.font = `600 22px ${FONT}`;
  c.fillText("UniDraw 你好 2D", 22, 128);
  c.fillStyle = "#9aa4bb";
  c.font = `400 12px ${FONT}`;
  c.fillText("Canvas2D parity · 0.5px hairline", 22, 146);

  // 9) 圆 + 旋转椭圆
  c.fillStyle = "#35d7ee";
  c.beginPath();
  c.arc(300, 190, 32, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 0.85;
  c.fillStyle = "#b07cff";
  c.beginPath();
  c.ellipse(392, 176, 44, 22, 0.45, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 1;

  // 10) 半透明粗折线（round join/cap 处不应出现接缝与二次混合）
  c.globalAlpha = 0.6;
  c.strokeStyle = "#ffffff";
  c.lineWidth = 13;
  c.lineJoin = "round";
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(252, 34);
  c.lineTo(300, 62);
  c.lineTo(346, 28);
  c.stroke();
  c.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// 两侧的适配
// ---------------------------------------------------------------------------

function nativeFactory(ctx: CanvasRenderingContext2D): GradientFactory {
  return {
    linear: (x0, y0, x1, y1) => ctx.createLinearGradient(x0, y0, x1, y1),
    radial: (cx, cy, r) => ctx.createRadialGradient(cx, cy, 0, cx, cy, r),
    clip: (c, x, y, w, h) => {
      c.beginPath();
      c.rect(x, y, w, h);
      ctx.clip();
    },
  };
}

function oursFactory(): GradientFactory {
  return {
    linear: (x0, y0, x1, y1) => new LinearGradient(x0, y0, x1, y1),
    radial: (cx, cy, r) => new RadialGradient(cx, cy, r),
    clip: (c, x, y, w, h) => c.clipRect?.(x, y, w, h),
  };
}

// ---------------------------------------------------------------------------
// 指标
// ---------------------------------------------------------------------------

interface Region {
  name: string;
  mean: number;
  over16: number;
  over48: number;
}

/** 场景：`?scene=parity`（默认，全能力） / `?scene=fillrules`（多子路径填充规则） */
const SCENES: Record<string, { label: string; draw: (c: SceneCtx, g: GradientFactory) => void; regions: typeof REGIONS }> = {
  parity: { label: "全能力", draw: drawScene, regions: REGIONS },
  fillrules: { label: "填充规则", draw: (c) => drawFillRules(c), regions: FILL_REGIONS },
};
const sceneId = params.get("scene") ?? "parity";
const scene = SCENES[sceneId] ?? SCENES.parity!;
const activeRegions = scene.regions;

function compare(a: Uint8ClampedArray | Uint8Array, b: Uint8ClampedArray | Uint8Array): { overall: Region; regions: Region[] } {
  const region = (x0: number, y0: number, w: number, h: number): { mean: number; over16: number; over48: number } => {
    let sum = 0;
    let n = 0;
    let o16 = 0;
    let o48 = 0;
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const i = (y * W + x) * 4;
        const d = (Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!)) / 3;
        sum += d;
        n++;
        if (d > 16) o16++;
        if (d > 48) o48++;
      }
    }
    return { mean: sum / Math.max(1, n), over16: o16 / Math.max(1, n), over48: o48 / Math.max(1, n) };
  };

  const all = region(0, 0, W, H);
  return {
    overall: { name: "整幅", ...all },
    regions: activeRegions.map((r) => ({ name: r.name, ...region(r.x, r.y, r.w, r.h) })),
  };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const errEl = document.createElement("div");
errEl.id = "err";
errEl.className = "err";
document.body.appendChild(errEl);

function layout(): { nativeSlot: HTMLElement; oursSlot: HTMLElement; stats: HTMLElement } {
  document.body.style.cssText = "margin:0;background:#0b0c10;color:#d7d9e0;font:12px ui-monospace,Consolas,monospace";
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:10px;padding:10px";
  const mk = (title: string) => {
    const box = document.createElement("div");
    const h = document.createElement("div");
    h.textContent = title;
    h.style.cssText = "padding:4px 0;color:#8b93a7";
    const slot = document.createElement("div");
    box.appendChild(h);
    box.appendChild(slot);
    row.appendChild(box);
    return slot;
  };
  const nativeSlot = mk("原生 Canvas2D");
  const oursSlot = mk("UniDraw Canvas2D");
  const stats = document.createElement("pre");
  stats.style.cssText = "margin:0;padding:0 12px 16px;color:#9aa4bb;white-space:pre-wrap";
  document.body.appendChild(row);
  document.body.appendChild(stats);
  return { nativeSlot, oursSlot, stats };
}

async function main(): Promise<void> {
  const { nativeSlot, oursSlot, stats } = layout();

  // ---- 原生 ----
  const nativeCanvas = document.createElement("canvas");
  nativeCanvas.width = W;
  nativeCanvas.height = H;
  nativeCanvas.style.cssText = "display:block;width:480px;height:270px";
  const nctx = nativeCanvas.getContext("2d", { willReadFrequently: true })!;
  nctx.clearRect(0, 0, W, H);
  scene.draw(nctx as unknown as SceneCtx, nativeFactory(nctx));
  const nativeData = nctx.getImageData(0, 0, W, H).data;
  nativeSlot.appendChild(nativeCanvas);

  // ---- 框架 ----
  const uniCanvas = document.createElement("canvas");
  uniCanvas.width = 8;
  uniCanvas.height = 8;
  const device = await createDevice({ canvas: uniCanvas, backend: (params.get("backend") ?? "auto") as "auto" | "webgpu" | "webgl2" | "mock" });
  const target = new RenderTarget(device, {
    label: "parity-2d",
    width: W,
    height: H,
    depth: false,
    sampleCount: SAMPLES,
    format: device.canvasFormat() ?? "rgba8unorm",
  });
  const c2d = new Canvas2D(device);
  const encoder = device.createCommandEncoder("parity");
  const pass = encoder.beginRenderPass({
    label: "parity-2d",
    colorAttachments: [target.colorAttachment({ clearValue: { r: 0, g: 0, b: 0, a: 0 } })],
    depthStencilAttachment: null,
  });
  c2d.setViewportSize(W, H);
  c2d.begin();
  scene.draw(c2d as unknown as SceneCtx, oursFactory());
  c2d.flush(pass, Mat4.ortho(0, W, H, 0, -1, 1));
  pass.end();
  device.submit([encoder.finish()]);

  const ours = await target.readPixels();
  const ourCanvas = document.createElement("canvas");
  ourCanvas.width = W;
  ourCanvas.height = H;
  ourCanvas.style.cssText = "display:block;width:480px;height:270px";
  ourCanvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(ours), W, H), 0, 0);
  oursSlot.appendChild(ourCanvas);

  // 半透明区域若两侧 alpha 语义不同，先确认一下
  let alphaMismatch = 0;
  for (let i = 3; i < ours.length; i += 4) if (Math.abs(ours[i]! - nativeData[i]!) > 8) alphaMismatch++;

  const { overall, regions } = compare(nativeData, ours);

  // 最优整数偏移：若「错开几像素后差异骤降」说明是整体位移（而不是图元质量问题）
  let best = { dx: 0, dy: 0, mean: Infinity };
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      let sum = 0;
      let n = 0;
      for (let y = 4; y < H - 4; y++) {
        for (let x = 4; x < W - 4; x++) {
          const i = (y * W + x) * 4;
          const j = ((y + dy) * W + (x + dx)) * 4;
          sum += (Math.abs(nativeData[i]! - ours[j]!) + Math.abs(nativeData[i + 1]! - ours[j + 1]!) + Math.abs(nativeData[i + 2]! - ours[j + 2]!)) / 3;
          n++;
        }
      }
      const m = sum / n;
      if (m < best.mean) best = { dx, dy, mean: m };
    }
  }

  // 差异热力图（每格平均通道差）—— 定位差异集中在哪些图元上
  const COLS = 80;
  const ROWS = 27;
  const ramp = " .:-=+*#%@";
  const mapLines: string[] = [];
  for (let cy = 0; cy < ROWS; cy++) {
    let line = "";
    for (let cx = 0; cx < COLS; cx++) {
      const x0 = Math.floor((cx * W) / COLS);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * W) / COLS));
      const y0 = Math.floor((cy * H) / ROWS);
      const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * H) / ROWS));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4;
          sum += (Math.abs(nativeData[i]! - ours[i]!) + Math.abs(nativeData[i + 1]! - ours[i + 1]!) + Math.abs(nativeData[i + 2]! - ours[i + 2]!)) / 3;
          n++;
        }
      }
      line += ramp[Math.min(9, Math.floor(((sum / n) / 96) * 10))];
    }
    mapLines.push(`PARITY_MAP ${String(cy).padStart(2, "0")} |${line}|`);
  }

  const lines = [
    `${device.kind} · msaa=${target.sampleCount} · ${W}x${H}`,
    `整幅      mean=${overall.mean.toFixed(2)}  >16:${(overall.over16 * 100).toFixed(2)}%  >48:${(overall.over48 * 100).toFixed(2)}%`,
    ...regions.map((r) => `${r.name.padEnd(8, " ")}  mean=${r.mean.toFixed(2).padStart(6)}  >16:${(r.over16 * 100).toFixed(2).padStart(5)}%  >48:${(r.over48 * 100).toFixed(2).padStart(5)}%`),
    `最优偏移  dx=${best.dx} dy=${best.dy} mean=${best.mean.toFixed(2)}（0,0 时 ${overall.mean.toFixed(2)}）`,
    `alpha 差异像素=${alphaMismatch}`,
  ];
  stats.textContent = lines.join("\n");
  for (const l of mapLines) console.log(l);

  // 定点取样：区分「颜色错了」还是「几何/边缘错了」
  const PROBES: [string, number, number][] = [
    ["圆角矩形内部", 395, 232],
    ["圆角矩形左上角", 341, 215],
    ["圆角矩形右上角", 449, 215],
    ["文字笔画", 40, 124],
    ["文字第二行", 40, 143],
    ["径向渐变中心", 430, 128],
    ["径向渐变中环", 430, 145],
    ["线性渐变 1/4", 90, 248],
    ["线性渐变 1/2", 160, 248],
    ["线性渐变 3/4", 230, 248],
    ["星形内部", 376, 66],
    ["圆内部", 300, 190],
  ];
  const px = (d: Uint8ClampedArray | Uint8Array, x: number, y: number) => {
    const i = (y * W + x) * 4;
    return `${d[i]},${d[i + 1]},${d[i + 2]}`;
  };
  for (const [name, x, y] of PROBES) {
    console.log(`PARITY_PX ${name} (${x},${y}) 原生=${px(nativeData, x, y)} 框架=${px(ours, x, y)}`);
  }

  console.log(
    "PARITY_SELFTEST " +
      JSON.stringify({
        backend: device.kind,
        msaa: target.sampleCount,
        width: W,
        height: H,
        mean: Number(overall.mean.toFixed(3)),
        over16: Number((overall.over16 * 100).toFixed(2)),
        over48: Number((overall.over48 * 100).toFixed(2)),
        bestShift: [best.dx, best.dy, Number(best.mean.toFixed(3))],
        alphaMismatch,
        regions: Object.fromEntries(regions.map((r) => [r.name, Number(r.mean.toFixed(2))])),
      }),
  );
}

const status = { err: "" };
(globalThis as Record<string, unknown>).__unidraw = {
  get status() {
    return { backend: params.get("backend") ?? "auto", err: status.err, fps: "", size: [W, H], frames: 1 };
  },
};

main().catch((e) => {
  status.err = e instanceof Error ? (e.stack ?? e.message) : String(e);
  errEl.textContent = status.err;
  console.log("PARITY_ERROR " + status.err);
});
