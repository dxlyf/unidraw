/**
 * 性能示例 · 单次 drawIndexed 的实例化压力
 *
 * 目的：观察 GPU 实例化吞吐 + 单 draw 内顶点着色器/索引开销。
 * 档位：4 096 / 16 384 / 65 536 / 131 072 / 262 144 个立方体实例。
 * 读法：一个 draw 内塞入的三角形数；帧耗时主要受顶点处理与填充率影响。
 */

import { bootBench, type BenchContext, type BenchScene } from "../common/bench.js";
import { UniformBlock } from "../../src/render/UniformBlock.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box } from "../../src/render/primitives.js";
import { BufferUsage, type VertexStateDescriptor } from "../../src/index.js";
import { clamp } from "../../src/math/mmath.js";

const INST_VERTEX_GLSL = `#version 300 es
precision highp float;
layout(std140) uniform CameraBlock { mat4 u_viewProj; };
layout(location = 0) in vec3 a_position;
layout(location = 3) in vec4 a_color;
layout(location = 4) in vec3 a_offset;
out vec4 v_color;
void main() {
  v_color = a_color;
  gl_Position = u_viewProj * vec4(a_position + a_offset, 1.0);
}
`;
const INST_FRAGMENT_GLSL = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 fragColor;
void main() { fragColor = v_color; }
`;
const INST_WGSL = `
struct CameraBlock { u_viewProj : mat4x4f, };
@group(0) @binding(0) var<uniform> camera : CameraBlock;
struct VSIn {
  @location(0) a_position : vec3f,
  @location(3) a_color : vec4f,
  @location(4) a_offset : vec3f,
};
struct VSOut { @builtin(position) clip_pos : vec4f, @location(0) v_color : vec4f, };
@vertex fn vs_main(in : VSIn) -> VSOut {
  var out : VSOut;
  out.v_color = in.a_color;
  out.clip_pos = camera.u_viewProj * vec4f(in.a_position + in.a_offset, 1.0);
  return out;
}
struct FSIn { @builtin(position) clip_pos : vec4f, @location(0) v_color : vec4f, };
@fragment fn fs_main(in : FSIn) -> @location(0) vec4f { return in.v_color; }
`;

const COUNTS = [4096, 16384, 65536, 131072, 262144];
const TRI_PER_BOX = 12;

bootBench({
  title: "性能 · 实例化压力（1 draw × N instances）",
  presets: COUNTS.map((count) => ({
    name: `${(count / 1024).toFixed(0)}k instances`,
    create(ctx: BenchContext): BenchScene {
      const device = ctx.device;

      const program = device.createProgram({
        label: "perf-inst",
        glsl: { vertex: INST_VERTEX_GLSL, fragment: INST_FRAGMENT_GLSL },
        wgsl: { code: INST_WGSL },
      });
      const layout = device.createBindGroupLayout({ entries: [{ binding: 0, type: "uniform-buffer", visibility: 1, name: "CameraBlock" }] });
      const vertexState: VertexStateDescriptor = {
        buffers: [
          { arrayStride: 32, stepMode: "vertex", attributes: [{ location: 0, format: "float32x3", offset: 0 }] },
          { arrayStride: 16, stepMode: "instance", attributes: [{ location: 3, format: "float32x4", offset: 0 }] },
          { arrayStride: 12, stepMode: "instance", attributes: [{ location: 4, format: "float32x3", offset: 0 }] },
        ],
      };
      const pipeline = device.createRenderPipeline({
        label: "perf-inst-pipe",
        program,
        bindGroupLayouts: [layout],
        vertex: vertexState,
        depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less-equal" },
        targets: [{ format: device.canvasFormat()! }],
      });
      const cameraBlock = new UniformBlock(device, { label: "inst-cam", fields: [{ name: "u_viewProj", type: "mat4" }] });
      const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: cameraBlock.buffer }] });

      // 实例数据（颜色随 i 连续变化，偏移呈方形网格）
      const cols = Math.ceil(Math.sqrt(count));
      const colors = new Float32Array(count * 4);
      const offsets = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const h = (i * 0.6180339887) % 1;
        const r = hue1(h);
        const g = hue2(h);
        const b = hue3(h);
        colors[i * 4] = r;
        colors[i * 4 + 1] = g;
        colors[i * 4 + 2] = b;
        colors[i * 4 + 3] = 1;
        const x = (i % cols) - (cols - 1) / 2;
        const z = Math.floor(i / cols) - (cols - 1) / 2;
        offsets[i * 3] = x;
        offsets[i * 3 + 1] = 0;
        offsets[i * 3 + 2] = z;
      }
      const colorBuffer = device.createBuffer({ label: "inst-colors", size: colors.byteLength, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
      colorBuffer.write(colors);
      const offsetBuffer = device.createBuffer({ label: "inst-offsets", size: offsets.byteLength, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
      offsetBuffer.write(offsets);

      const cube = Geometry.create(device, box(0.82, 0.82, 0.82));
      const extent = cols * 0.92;
      ctx.camera.distance = clamp(extent * 0.62, 8, 500);
      ctx.camera.center.set(0, extent * 0.05, 0);

      return {
        draw(pass, _time, ctx2) {
          cameraBlock.setMat4("u_viewProj", ctx2.camera.viewProjection);
          cameraBlock.flush();
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, group);
          pass.setVertexBuffer(0, cube.vertexBuffer);
          pass.setVertexBuffer(1, colorBuffer);
          pass.setVertexBuffer(2, offsetBuffer);
          if (!cube.indexBuffer || !cube.indexFormat) throw new Error("box 缺少索引");
          pass.setIndexBuffer(cube.indexBuffer, cube.indexFormat);
          pass.drawIndexed(cube.indexCount, count);
        },
        status() {
          return `1 drawIndexed(${count.toLocaleString()} instances)\n总三角形 ≈ ${(count * TRI_PER_BOX).toLocaleString()}`;
        },
      };
    },
  })),
});

function hue1(h: number): number {
  return clamp01(Math.abs(((h * 6 + 0) % 6) - 3) - 1);
}
function hue2(h: number): number {
  return clamp01(2 - Math.abs(((h * 6 + 2) % 6) - 3));
}
function hue3(h: number): number {
  return clamp01(2 - Math.abs(((h * 6 + 4) % 6) - 3));
}
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
