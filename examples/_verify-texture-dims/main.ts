/**
 * 纹理维度验证页（3D / 2D 数组 / cube）
 *
 * 这两个后端都要能创建、逐层上传、并让内容真正落到位。这里不做着色器采样，而是
 * **用原生句柄把每一层读回来**对账（WebGL2 `framebufferTextureLayer` + `readPixels`，
 * WebGPU `copyTextureToBuffer` + `mapAsync`），因此不依赖任何 shader 就能验证：
 *
 * - `TextureDescriptor.dimension / depthOrArrayLayers` 是否被两个后端正确落实；
 * - `upload(..., { z, depth })` 是否写到了正确的层；
 * - cube 的 6 个面是否各自独立（WebGL2 走 `texStorage2D(TEXTURE_CUBE_MAP)`）。
 *
 * 控制台打印 `TEXDIMS_SELFTEST {...}`，同时挂在 `window.__texdims` 上供探针读取。
 */

import { createDevice } from "../../src/device/createDevice.js";
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
  console.log("TEXDIMS_SELFTEST " + JSON.stringify(result));
}

main().catch((e) => {
  const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
  // 控制台可能被探针漏抓（页面比 CDP 先跑完），所以也挂到全局上
  (globalThis as Record<string, unknown>).__texdimsError = msg;
  console.log("TEXDIMS_ERROR " + msg);
});
