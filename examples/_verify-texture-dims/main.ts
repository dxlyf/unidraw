/**
 * 纹理维度验证页（3D / 2D 数组 / cube + 分层渲染附件 + 浮点/深度回读）
 *
 * 这两个后端都要能创建、逐层上传、并让内容真正落到位。这里不做着色器采样，而是
 * **用原生句柄把每一层读回来**对账（WebGL2 `framebufferTextureLayer` + `readPixels`，
 * WebGPU `copyTextureToBuffer` + `mapAsync`），因此不依赖任何 shader 就能验证：
 *
 * - `TextureDescriptor.dimension / depthOrArrayLayers` 是否被两个后端正确落实；
 * - `upload(..., { z, depth })` 是否写到了正确的层；
 * - cube 的 6 个面是否各自独立（WebGL2 走 `texStorage2D(TEXTURE_CUBE_MAP)`）；
 * - **分层渲染附件**：`RenderTarget({ dimension })` + `colorAttachment({ layer })`
 *   逐层/逐面清成不同颜色，再用 `readTexturePixels({ layer })` 逐层读回；
 * - 浮点回读（`rgba32float`）与深度回读（`depth32float` / 分层深度数组）；
 * - **回读行序**：上传纹理的第 0 行必须原样出现在输出第 0 行（WebGL2 的
 *   「渲染过的纹理」与「上传的纹理」内存行序相反，曾经统一翻转导致过上下颠倒）。
 *
 * 控制台打印 `TEXDIMS_SELFTEST {...}`，同时挂在 `window.__texdims` 上供探针读取。
 */

import { createDevice } from "../../src/device/createDevice.js";
import { RenderTarget } from "../../src/render/RenderTarget.js";
import { TextureUsage } from "../../src/gpu/types.js";
import type { Device } from "../../src/device/Device.js";
import type { Texture } from "../../src/device/resources.js";

const params = new URLSearchParams(location.search);
const SIZE = 4;
const BYTES = SIZE * SIZE * 4;

const canvas = document.createElement("canvas");
canvas.width = 8;
canvas.height = 8;
document.body.appendChild(canvas);

const device: Device = await createDevice({
  canvas,
  backend: (params.get("backend") ?? "auto") as "auto" | "webgpu" | "webgl2" | "mock",
});

/** 一层的像素：R = tag，G = tag+1，B = tag+2，A = 255（便于看出写错层） */
function layerBytes(tag: number): Uint8Array {
  const b = new Uint8Array(BYTES);
  for (let i = 0; i < SIZE * SIZE; i++) {
    b[i * 4] = tag;
    b[i * 4 + 1] = tag + 1;
    b[i * 4 + 2] = tag + 2;
    b[i * 4 + 3] = 255;
  }
  return b;
}

function makeTexture(dimension: "2d" | "3d" | "2d-array" | "cube", layers: number, label: string): Texture {
  return device.createTexture({
    label,
    width: SIZE,
    height: SIZE,
    dimension,
    depthOrArrayLayers: layers,
    format: "rgba8unorm",
    usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_SRC | TextureUsage.COPY_DST,
  });
}

/** 读回某一层的左上角像素（两个后端各一条路径） */
async function readLayer(tex: Texture, layer: number): Promise<number[]> {
  if (device.kind === "webgl2") {
    const gl = (device as unknown as { gl: WebGL2RenderingContext }).gl;
    const raw = tex as unknown as { glTexture: WebGLTexture };
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    if (tex.dimension === "cube") {
      // cube 的某一面要用**面目标**挂附件：framebufferTextureLayer 对 cube 无效，
      // FBO 会不完整 → readPixels 全 0（这次验证才发现要区分这两种挂法）
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + layer, raw.glTexture, 0);
    } else {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, raw.glTexture, 0, layer);
    }
    const px = new Uint8Array(BYTES);
    gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    return [px[0]!, px[1]!, px[2]!, px[3]!];
  }
  const gpu = (device as unknown as { gpu: GPUDevice }).gpu;
  const raw = tex as unknown as { gpuTexture: GPUTexture };
  const buf = gpu.createBuffer({ size: 256 * SIZE, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = gpu.createCommandEncoder();
  enc.copyTextureToBuffer(
    { texture: raw.gpuTexture, origin: { x: 0, y: 0, z: layer } },
    { buffer: buf, bytesPerRow: 256, rowsPerImage: SIZE },
    { width: SIZE, height: SIZE, depthOrArrayLayers: 1 },
  );
  gpu.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const view = new Uint8Array(buf.getMappedRange());
  const out = [view[0]!, view[1]!, view[2]!, view[3]!];
  buf.unmap();
  buf.destroy();
  return out;
}

async function main(): Promise<void> {
  // 1) 2D 数组：3 层，逐层上传
  const array = makeTexture("2d-array", 3, "verify-array3");
  for (let l = 0; l < 3; l++) array.upload(layerBytes(10 + l * 40), { z: l });

  // 2) 3D：4 层，一次上传整卷（紧密排列）
  const vol = makeTexture("3d", 4, "verify-vol4");
  const packed = new Uint8Array(BYTES * 4);
  for (let z = 0; z < 4; z++) packed.set(layerBytes(20 + z * 30), z * BYTES);
  vol.upload(packed, { depth: 4 });

  // 3) cube：6 个面，逐面上传
  const cube = makeTexture("cube", 6, "verify-cube6");
  for (let f = 0; f < 6; f++) cube.upload(layerBytes(90 + f * 10), { z: f });

  const arrayReads: number[][] = [];
  for (let l = 0; l < 3; l++) arrayReads.push(await readLayer(array, l));
  const volReads: number[][] = [];
  for (let z = 0; z < 4; z++) volReads.push(await readLayer(vol, z));
  const cubeReads: number[][] = [];
  for (let f = 0; f < 6; f++) cubeReads.push(await readLayer(cube, f));

  // 期望值：第 l 层的 R 通道 = 该层上传的 tag
  const check = (reads: number[][], tags: number[]): boolean => reads.every((p, i) => p[0] === tags[i]);
  const result = {
    backend: device.kind,
    arrayOk: check(arrayReads, [10, 50, 90]),
    volOk: check(volReads, [20, 50, 80, 110]),
    cubeOk: check(cubeReads, [90, 100, 110, 120, 130, 140]),
    arrayReads,
    volReads,
    cubeReads,
    dims: [array.dimension, array.depthOrArrayLayers, vol.dimension, vol.depthOrArrayLayers, cube.dimension, cube.depthOrArrayLayers],
  };
  (globalThis as Record<string, unknown>).__texdims = result;
  // 4) 浮点回读：rgba32float 上传 → 以 float32 回读
  const ftex = device.createTexture({
    label: "verify-float",
    width: 2,
    height: 2,
    format: "rgba32float",
    usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_SRC | TextureUsage.COPY_DST,
  });
  const fsrc = new Float32Array([1.5, 0.25, -2, 1, 0.5, 0.125, 3, 1, 4, 8, 16, 1, 0.0625, 1, 1, 1]);
  ftex.upload(fsrc);
  let fdata: Float32Array<ArrayBufferLike> = new Float32Array(0);
  let floatErr = "";
  try {
    fdata = new Float32Array((await device.readTexturePixels(ftex, { type: "float32" })).buffer);
  } catch (e) {
    floatErr = e instanceof Error ? e.message : String(e);
  }
  const floatOk = Math.abs(fdata[0]! - 1.5) < 1e-5 && Math.abs(fdata[6]! - 3) < 1e-5 && Math.abs(fdata[12]! - 0.0625) < 1e-6;

  // 5) 深度回读：深度目标清成 0.5 再读回（用深度专用 pass：colorAttachments 为空）
  const depthTarget = new RenderTarget(device, {
    label: "verify-depth",
    width: 2,
    height: 2,
    depth: "depth32float",
    sampleCount: 1,
  });
  const denc = device.createCommandEncoder("verify-depth");
  const dpass = denc.beginRenderPass({
    label: "verify-depth",
    colorAttachments: [],
    depthStencilAttachment: depthTarget.depthAttachment({ depthClearValue: 0.5 }),
  });
  dpass.end();
  device.submit([denc.finish()]);
  const depthTex = depthTarget.depth;
  let ddata: Float32Array<ArrayBufferLike> = new Float32Array(0);
  let depthErr = "";
  try {
    ddata = depthTex ? new Float32Array((await device.readTexturePixels(depthTex, { type: "float32" })).buffer) : new Float32Array(0);
  } catch (e) {
    depthErr = e instanceof Error ? e.message : String(e);
  }
  const depthOk = ddata.length > 0 && Math.abs(ddata[0]! - 0.5) < 0.01;

  (result as Record<string, unknown>).floatOk = floatOk;
  (result as Record<string, unknown>).depthOk = depthOk;
  (result as Record<string, unknown>).floatSample = [fdata[0], fdata[6], fdata[12]];
  (result as Record<string, unknown>).depthSample = ddata[0];
  (result as Record<string, unknown>).floatErr = floatErr;
  (result as Record<string, unknown>).depthErr = depthErr;

  // 6) 行序：上传 3 行（红/绿/蓝）后原样回读。
  // 这一项抓到过一个真 bug：WebGL2 里「被渲染附件写过」的纹理与「只用 upload 写过」
  // 的纹理内存行序相反，早先统一翻转 Y，导致上传纹理回读出来上下颠倒
  // （WebGPU 侧一直是对的，所以只看单后端发现不了）。两边的第 0 行都必须还是红。
  const rows = device.createTexture({
    label: "verify-row-order",
    width: 1,
    height: 3,
    format: "rgba8unorm",
    usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_SRC | TextureUsage.COPY_DST,
  });
  rows.upload(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]));
  const rowPixels = Array.from(await device.readTexturePixels(rows));
  const rowOrderOk = rowPixels.slice(0, 4).join(",") === "255,0,0,255" && rowPixels.slice(4, 8).join(",") === "0,255,0,255";
  (result as Record<string, unknown>).rowOrderOk = rowOrderOk;
  (result as Record<string, unknown>).rowPixels = rowPixels;

  // 7) 分层渲染附件：每层/每面清成不同的 R 值，再逐层回读
  //    （cube 逐面 + 2D 数组逐层 = 点光源 cube 阴影那种写法的地基）
  const layered: Record<string, unknown> = {};
  for (const [tag, dim, layers] of [
    ["array", "2d-array", 3],
    ["cube", "cube", 6],
  ] as const) {
    const rt = new RenderTarget(device, {
      label: `verify-layer-${tag}`,
      width: SIZE,
      height: SIZE,
      depth: false,
      sampleCount: 4, // 分层模式必须被降级成 1（WebGL2 无法做分层多重采样附件）
      dimension: dim,
      depthOrArrayLayers: dim === "cube" ? undefined : layers,
    });
    const count = rt.depthOrArrayLayers;
    const enc = device.createCommandEncoder(`verify-layer-${tag}`);
    for (let l = 0; l < count; l++) {
      const pass = enc.beginRenderPass({
        label: `layer-${l}`,
        colorAttachments: [rt.colorAttachment({ layer: l, clearValue: { r: (l + 1) * 32 / 255, g: 0, b: 0, a: 1 } })],
        depthStencilAttachment: null,
      });
      pass.end();
    }
    device.submit([enc.finish()]);
    const reads: number[] = [];
    for (let l = 0; l < count; l++) {
      const px = await device.readTexturePixels(rt.texture, { layer: l, width: 1, height: 1 });
      reads.push(px[0]!);
    }
    const expect = Array.from({ length: count }, (_, l) => (l + 1) * 32);
    layered[`${tag}Ok`] = reads.join(",") === expect.join(",");
    layered[`${tag}Reads`] = reads;
    layered[`${tag}Count`] = count;
    layered[`${tag}SampleCount`] = rt.sampleCount;
    rt.dispose();
  }

  // 8) 分层深度：2D 数组深度逐层清成不同值再逐层回读（点光源 cube 阴影的深度布局）
  const depthRt = new RenderTarget(device, {
    label: "verify-layer-depth",
    width: SIZE,
    height: SIZE,
    depth: "depth32float",
    dimension: "2d-array",
    depthOrArrayLayers: 2,
  });
  const denc2 = device.createCommandEncoder("verify-layer-depth");
  for (let l = 0; l < 2; l++) {
    const pass = denc2.beginRenderPass({
      label: `depth-layer-${l}`,
      colorAttachments: [],
      depthStencilAttachment: depthRt.depthAttachment({ layer: l, depthClearValue: l === 0 ? 0.25 : 0.75 }),
    });
    pass.end();
  }
  device.submit([denc2.finish()]);
  const depthReads: number[] = [];
  let layeredDepthErr = "";
  try {
    for (let l = 0; l < 2; l++) {
      const px = depthRt.depth ? await device.readTexturePixels(depthRt.depth, { layer: l, type: "float32", width: 1, height: 1 }) : new Uint8Array(0);
      depthReads.push(px.length ? new Float32Array(px.buffer)[0]! : NaN);
    }
  } catch (e) {
    layeredDepthErr = e instanceof Error ? e.message : String(e);
  }
  layered.layeredDepthOk = depthReads.length === 2 && Math.abs(depthReads[0]! - 0.25) < 0.01 && Math.abs(depthReads[1]! - 0.75) < 0.01;
  layered.layeredDepthReads = depthReads;
  layered.layeredDepthErr = layeredDepthErr;
  depthRt.dispose();
  (result as Record<string, unknown>).layered = layered;

  // 全局要在**补齐 float/depth 字段之后**再写一次，探针读的是这里
  (globalThis as Record<string, unknown>).__texdims = result;
  console.log("TEXDIMS_SELFTEST " + JSON.stringify(result));
}

main().catch((e) => {
  const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
  // 控制台可能被探针漏抓（页面比 CDP 先跑完），所以也挂到全局上
  (globalThis as Record<string, unknown>).__texdimsError = msg;
  console.log("TEXDIMS_ERROR " + msg);
});
