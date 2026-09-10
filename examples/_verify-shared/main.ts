// 临时验证示例：共享材质 + 逐物体模型矩阵 + 材质交替（动态偏移 UBO 回归测试）
//
// 场景：三个同样的立方体。左右两个**共用同一个 Unlit 材质实例**（颜色恒定，便于数值比对），
// 中间夹一个 Color 材质（带光照，着色有梯度）。绘制顺序：
//   共享 → 其他 → 共享   （同时覆盖「同一材质实例被多个物体复用」与「管线交替」两条路径）
//
// 结果：离屏渲染（rgba8unorm + 深度）→ device.readTexturePixels → 逐物体采样，
// 输出到 console 与 window.__unidraw.status 供无头探针断言。
import { Renderer } from "../../src/render/Renderer.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box } from "../../src/render/primitives.js";
import { ColorMaterial, UnlitColorMaterial } from "../../src/render/material.js";
import { Mesh } from "../../src/render/Mesh.js";
import { Camera } from "../../src/render/Camera.js";
import { Color } from "../../src/math/color.js";
import { TextureUsage } from "../../src/gpu/types.js";
import { degToRad } from "../../src/math/mmath.js";
import type { Device } from "../../src/device/Device.js";

const W = 320;
const H = 200;

interface Status {
  backend: string;
  err: string;
  frames: number;
  result?: Record<string, unknown>;
}
const status: Status = { backend: "", err: "", frames: 0 };
(globalThis as Record<string, unknown>).__unidraw = { get status() { return status; } };

window.addEventListener("error", (e) => (status.err = e.message));
window.addEventListener("unhandledrejection", (e) => {
  status.err = e.reason instanceof Error ? e.reason.message : String(e.reason);
});

const canvas = document.createElement("canvas");
canvas.id = "canvas";
canvas.width = W;
canvas.height = H;
document.body.style.cssText = "margin:0;background:#0b0c10";
document.body.appendChild(canvas);

const backend = new URLSearchParams(location.search).get("backend") as "auto" | "webgpu" | "webgl2" | null;
const renderer = await Renderer.create(canvas, { backend: backend ?? "auto", depth: false });
const device: Device = renderer.device;
status.backend = device.kind;

const geometry = Geometry.create(device, box(1, 1, 1));
const shared = new UnlitColorMaterial(device, new Color().setHex("#4c8dff"), { label: "shared", targetFormat: "rgba8unorm" });
const other = new ColorMaterial(device, new Color().setHex("#3dd68c"), { label: "other", targetFormat: "rgba8unorm" });

/** [mesh, material, x] —— 绘制顺序刻意交错：sharedA → other → sharedB */
const items: { mesh: Mesh; material: UnlitColorMaterial | ColorMaterial; x: number }[] = [
  { mesh: new Mesh(geometry), material: shared, x: -1.6 },
  { mesh: new Mesh(geometry), material: other, x: 0 },
  { mesh: new Mesh(geometry), material: shared, x: 1.6 },
];
items.forEach((it) => it.mesh.model.setIdentity().translate(it.x, 0, 0));

const camera = new Camera();
camera.setPerspective(degToRad(55), W / H, 0.1, 100);
camera.center.set(0, 0, 0);
camera.distance = 5.2;
camera.update();

const color = device.createTexture({
  label: "verify-color",
  width: W,
  height: H,
  format: "rgba8unorm",
  usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.COPY_SRC,
});
const depth = device.createTexture({
  label: "verify-depth",
  width: W,
  height: H,
  format: "depth24plus",
  usage: TextureUsage.RENDER_ATTACHMENT,
});

const BACKGROUND = { r: 0.04, g: 0.04, b: 0.06, a: 1 };

function drawInto(): void {
  const encoder = device.createCommandEncoder("verify");
  const pass = encoder.beginRenderPass({
    label: "verify",
    colorAttachments: [{ view: color.view(), loadOp: "clear", storeOp: "store", clearValue: BACKGROUND }],
    depthStencilAttachment: { view: depth.view(), depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: 1 },
  });
  const vp = camera.viewProjection;
  const eye = camera.eyePosition;
  shared.beginFrame(vp, eye);
  other.beginFrame(vp, eye);
  for (const it of items) it.material.draw(pass, it.mesh);
  pass.end();
  device.submit([encoder.finish()]);
}

/** 世界坐标 → 像素坐标（左上原点） */
function worldToPixel(x: number, y: number, z: number): { px: number; py: number } {
  const m = camera.viewProjection.elements;
  const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  return {
    px: Math.round(((cx / cw) * 0.5 + 0.5) * W),
    py: Math.round((1 - ((cy / cw) * 0.5 + 0.5)) * H),
  };
}

function sample(pixels: Uint8Array, x: number, y: number): [number, number, number] {
  const i = (y * W + x) * 4;
  return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
}

function luminance(rgb: [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** 以 (cx,cy) 为中心、半径 r 的方框内的亮度统计（max-min 反映着色梯度） */
function regionStats(pixels: Uint8Array, cx: number, cy: number, r: number): { mean: number; max: number; min: number; n: number } {
  let sum = 0;
  let max = -1;
  let min = 999;
  let n = 0;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const l = luminance(sample(pixels, x, y));
      sum += l;
      max = Math.max(max, l);
      min = Math.min(min, l);
      n++;
    }
  }
  return { mean: sum / Math.max(1, n), max, min, n };
}

/** 把回读结果打印成文本灰度图（无头验证时“看图”）。 */
function asciiArt(pixels: Uint8Array, cols = 64, rows = 20): string {
  const ramp = " .:-=+*#%@";
  const lines: string[] = [];
  for (let cy = 0; cy < rows; cy++) {
    let line = "";
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor((cx * W) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * W) / cols));
      const y0 = Math.floor((cy * H) / rows);
      const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * H) / rows));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          sum += luminance(sample(pixels, x, y));
          n++;
        }
      }
      line += ramp[Math.min(ramp.length - 1, Math.floor(((sum / n) / 255) * ramp.length))];
    }
    lines.push(line);
  }
  return lines.join("\n");
}

async function verify(): Promise<void> {
  drawInto();
  const pixels = await device.readTexturePixels(color);
  // 采样点取「+Z 面中心」（世界 z=+0.5），保证落在正对相机的同一个面上
  const boxes = items.map((it) => {
    const { px, py } = worldToPixel(it.x, 0, 0.5);
    const rgb = sample(pixels, px, py);
    const stats = regionStats(pixels, px, py, 8);
    return {
      x: it.x,
      px,
      py,
      rgb,
      meanL: Number(stats.mean.toFixed(2)),
      spread: Number((stats.max - stats.min).toFixed(2)),
    };
  });
  const [a, c, b] = boxes as [typeof boxes[0], typeof boxes[0], typeof boxes[0]];
  const bgL = luminance(sample(pixels, 4, 4));
  const result = {
    backgroundL: Number(bgL.toFixed(2)),
    boxes,
    art: asciiArt(pixels),
    // 断言 1：左右两个共享材质的物体都出现在各自位置（逐物体模型矩阵生效）
    bothVisible: luminance(a.rgb) > bgL + 10 && luminance(b.rgb) > bgL + 10,
    // 断言 2：两者渲染结果一致（同一 Unlit 材质 → 颜色/亮度几乎相同）
    sharedConsistent: Math.abs(a.meanL - b.meanL) < 1.5,
    // 断言 3：中间物体来自另一个材质（绿色），且带光照梯度（说明管线确实切换了）
    middleGreen: c.rgb[1] > c.rgb[0] + 20 && c.rgb[1] > c.rgb[2] + 20,
    sharedFlat: a.spread < 1.5 && b.spread < 1.5,
  };
  status.result = result;
  console.log("VERIFY_RESULT " + JSON.stringify(result));
  console.log("VERIFY_ART\n" + result.art);
}

let frames = 0;
function loop(): void {
  drawInto();
  status.frames = ++frames;
  if (frames === 12) {
    void verify().catch((e) => {
      status.err = e instanceof Error ? e.message : String(e);
      console.log("VERIFY_ERROR " + status.err);
    });
  }
  requestAnimationFrame(loop);
}
loop();
