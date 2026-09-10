// 临时验证页：相机正对极点/顶点渲染，检查「极点是否有洞」（背景为洋红，物体为蓝色）
//
// 上半球极点是球体贴图网格最容易出洞的地方：如果极点扇形三角形退化，
// 从正上方看就会在画面中心看到背景色（洞）。
import { Renderer } from "../../src/render/Renderer.js";
import { Geometry } from "../../src/render/Geometry.js";
import { capsule, cone, sphere } from "../../src/render/primitives.js";
import { UnlitColorMaterial } from "../../src/render/material.js";
import { Mesh } from "../../src/render/Mesh.js";
import { Camera } from "../../src/render/Camera.js";
import { Color } from "../../src/math/color.js";
import { TextureUsage } from "../../src/gpu/types.js";
import type { GeometryData } from "../../src/render/Geometry.js";
import type { Device } from "../../src/device/Device.js";

const W = 200;
const H = 200;
const MAGENTA = { r: 1, g: 0, b: 1, a: 1 };
const SPHERE_R = 1;
const DIST = 3.2;

const status: { backend: string; err: string; frames: number } = { backend: "", err: "", frames: 0 };
(globalThis as Record<string, unknown>).__unidraw = { get status() { return status; } };
window.addEventListener("error", (e) => (status.err = e.message));
window.addEventListener("unhandledrejection", (e) => {
  status.err = e.reason instanceof Error ? e.reason.message : String(e.reason);
});

const canvas = document.createElement("canvas");
canvas.width = W;
canvas.height = H;
document.body.style.cssText = "margin:0;background:#0b0c10";
document.body.appendChild(canvas);

const backend = new URLSearchParams(location.search).get("backend") as "auto" | "webgpu" | "webgl2" | null;
const device: Device = (await Renderer.create(canvas, { backend: backend ?? "auto", depth: false })).device;
status.backend = device.kind;

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

const material = new UnlitColorMaterial(device, new Color().setHex("#4c8dff"), {
  label: "verify",
  targetFormat: "rgba8unorm",
});
const materialNoCull = new UnlitColorMaterial(device, new Color().setHex("#4c8dff"), {
  label: "verify-nocull",
  targetFormat: "rgba8unorm",
  cullMode: "none",
});

interface Case {
  name: string;
  data: GeometryData;
  /** 相机俯仰角：-90° 表示正上方俯视（看北极/顶点） */
  pitchDeg: number;
  /** 期望在此半径内不应出现背景色（像素） */
  discRadius: number;
  /** 圆心是否必须落在物体上（正对极点时为 true；斜视时会落在物体外） */
  centerOnObject: boolean;
  /** 关闭背面剔除（用于区分「洞」与「绕序被剔掉」） */
  noCull?: boolean;
}

const cases: Case[] = [
  { name: "sphere 正上方(北极)", data: sphere(SPHERE_R, 32, 16), pitchDeg: -90, discRadius: 52, centerOnObject: true },
  { name: "sphere 正下方(南极)", data: sphere(SPHERE_R, 32, 16), pitchDeg: 90, discRadius: 52, centerOnObject: true },
  { name: "capsule 正上方(顶极)", data: capsule(0.5, 0.8, 32, 8), pitchDeg: -90, discRadius: 20, centerOnObject: true },
  { name: "cone 正上方(顶点)", data: cone(0.5, 1, 32), pitchDeg: -90, discRadius: 18, centerOnObject: true },
  // 同一个目标纹理上连续多个 pass：若深度没被清，后面的物体就会被前一个挡住
  { name: "capsule 再次渲染(深度清除)", data: capsule(0.5, 0.8, 32, 8), pitchDeg: -90, discRadius: 20, centerOnObject: true },
];

function renderCase(item: Case): void {
  const geometry = Geometry.create(device, item.data);
  const mesh = new Mesh(geometry);
  const mat = item.noCull ? materialNoCull : material;
  mesh.material = mat;

  const camera = new Camera();
  camera.setPerspective(Math.PI / 4, W / H, 0.1, 100);
  camera.center.set(0, 0, 0);
  camera.distance = DIST;
  camera.pitch = (item.pitchDeg * Math.PI) / 180;
  camera.update();

  const encoder = device.createCommandEncoder("verify");
  const pass = encoder.beginRenderPass({
    colorAttachments: [{ view: color.view(), loadOp: "clear", storeOp: "store", clearValue: MAGENTA }],
    depthStencilAttachment: { view: depth.view(), depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: 1 },
  });
  mat.beginFrame(camera.viewProjection, camera.eyePosition);
  mat.drawGeometry(pass, geometry, mesh.worldMatrix);
  pass.end();
  device.submit([encoder.finish()]);
}

async function run(): Promise<void> {
  const results: Record<string, unknown>[] = [];
  for (const item of cases) {
    renderCase(item);
    const pixels = await device.readTexturePixels(color);
    const at = (x: number, y: number) => {
      const i = (y * W + x) * 4;
      return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
    };
    const isMagenta = (rgb: number[]) => rgb[0]! > 200 && rgb[1]! < 60 && rgb[2]! > 200;
    const center = at(W >> 1, H >> 1);
    // 在期望圆盘内统计「背景色」像素（即洞）
    let holes = 0;
    let discPixels = 0;
    const cx = W >> 1;
    const cy = H >> 1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (Math.hypot(x - cx, y - cy) > item.discRadius) continue;
        discPixels++;
        if (isMagenta(at(x, y))) holes++;
      }
    }
    results.push({
      name: item.name,
      center,
      centerIsHole: isMagenta(center),
      holes,
      discPixels,
      art: ascii(pixels),
      ok: (!item.centerOnObject || !isMagenta(center)) && holes === 0,
    });
  }
  const ok = results.every((r) => r.ok === true);
  console.log("SPHERE_SELFTEST " + JSON.stringify({ backend: device.kind, ok, cases: results.map(({ art, ...rest }) => rest) }));
  for (const r of results) console.log(`SPHERE_ART [${r.name}]\n${r.art}`);
}

/** 文本灰度图：非背景为 '#', 背景为 '.' */
function ascii(pixels: Uint8Array, cols = 48, rows = 16): string {
  const lines: string[] = [];
  for (let cy = 0; cy < rows; cy++) {
    let line = "";
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor((cx * W) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * W) / cols));
      const y0 = Math.floor((cy * H) / rows);
      const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * H) / rows));
      let objectPixels = 0;
      let total = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4;
          total++;
          if (!(pixels[i]! > 200 && pixels[i + 1]! < 60 && pixels[i + 2]! > 200)) objectPixels++;
        }
      }
      line += objectPixels / total > 0.5 ? "#" : objectPixels > 0 ? "+" : ".";
    }
    lines.push(line);
  }
  return lines.join("\n");
}

let frames = 0;
function loop(): void {
  status.frames = ++frames;
  if (frames === 8) {
    void run().catch((e) => console.log("SPHERE_SELFTEST_ERROR " + (e instanceof Error ? e.message : String(e))));
  }
  requestAnimationFrame(loop);
}
loop();
