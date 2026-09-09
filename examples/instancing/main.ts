/**
 * 实例化示例 —— 展示“底层统一命令 API”：
 * 自定义双端着色器 + 多 slot 顶点缓冲（含 instance step）+ drawIndexed(instanceCount)。
 */

import { bootDemo } from "../common/demo.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box } from "../../src/render/primitives.js";
import { UniformBlock } from "../../src/render/UniformBlock.js";
import { BufferUsage } from "../../src/gpu/types.js";
import type { VertexStateDescriptor } from "../../src/device/descriptors.js";

// ---------------------------------------------------------------------------
// 自定义着色器（GLSL + WGSL 双实现）
// ---------------------------------------------------------------------------

const INST_VERTEX_GLSL = `#version 300 es
precision highp float;
layout(std140) uniform CameraBlock {
  mat4 u_viewProj;
};
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
void main() {
  fragColor = v_color;
}
`;

const INST_WGSL = `
struct CameraBlock {
  u_viewProj : mat4x4f,
};
@group(0) @binding(0) var<uniform> camera : CameraBlock;

struct VSIn {
  @location(0) a_position : vec3f,
  @location(3) a_color : vec4f,
  @location(4) a_offset : vec3f,
};
struct VSOut {
  @builtin(position) clip_pos : vec4f,
  @location(0) v_color : vec4f,
};
@vertex
fn vs_main(in : VSIn) -> VSOut {
  var out : VSOut;
  out.v_color = in.a_color;
  out.clip_pos = camera.u_viewProj * vec4f(in.a_position + in.a_offset, 1.0);
  return out;
}
struct FSIn {
  @builtin(position) clip_pos : vec4f,
  @location(0) v_color : vec4f,
};
@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  return in.v_color;
}
`;

// ---------------------------------------------------------------------------

const COUNT_X = 9;
const COUNT_Z = 9;
const INSTANCE_COUNT = COUNT_X * COUNT_Z;
const SPACING = 1.15;

bootDemo({
  title: "实例化 · 自定义着色器 + instance 顶点流（drawIndexed × N）",
  run(ctx) {
    const { device } = ctx;
    ctx.camera.distance = 11;
    ctx.camera.pitch = -0.32;
    ctx.camera.update();

    // 顶点状态：slot0 = 几何（标准布局中仅用 position）；slot1/2 = instance 流
    const vertexState: VertexStateDescriptor = {
      buffers: [
        { arrayStride: 32, stepMode: "vertex", attributes: [{ location: 0, format: "float32x3", offset: 0 }] },
        { arrayStride: 16, stepMode: "instance", attributes: [{ location: 3, format: "float32x4", offset: 0 }] },
        { arrayStride: 12, stepMode: "instance", attributes: [{ location: 4, format: "float32x3", offset: 0 }] },
      ],
    };

    const program = device.createProgram({
      label: "instancing",
      glsl: { vertex: INST_VERTEX_GLSL, fragment: INST_FRAGMENT_GLSL },
      wgsl: { code: INST_WGSL },
    });
    const layout = device.createBindGroupLayout({
      entries: [{ binding: 0, type: "uniform-buffer", visibility: 1, name: "CameraBlock" }], // VERTEX
    });
    const pipeline = device.createRenderPipeline({
      label: "instancing-pipe",
      program,
      bindGroupLayouts: [layout],
      vertex: vertexState,
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less-equal" },
      targets: [{ format: device.canvasFormat()! }],
    });

    const cameraBlock = new UniformBlock(device, { label: "inst-camera", fields: [{ name: "u_viewProj", type: "mat4" }] });
    const group = device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: cameraBlock.buffer }],
    });

    // instance 数据
    const colors = new Float32Array(INSTANCE_COUNT * 4);
    const offsets = new Float32Array(INSTANCE_COUNT * 3);
    for (let x = 0; x < COUNT_X; x++) {
      for (let z = 0; z < COUNT_Z; z++) {
        const i = x * COUNT_Z + z;
        const px = (x - (COUNT_X - 1) / 2) * SPACING;
        const pz = (z - (COUNT_Z - 1) / 2) * SPACING;
        // HSL → RGB 近似
        const hue = (x / COUNT_X + z / COUNT_Z) / 2;
        const h = hue * 6;
        const r = clamp01(Math.abs(h - 3) - 1);
        const g = clamp01(2 - Math.abs(h - 2));
        const b = clamp01(2 - Math.abs(h - 4));
        colors[i * 4] = r;
        colors[i * 4 + 1] = g;
        colors[i * 4 + 2] = b;
        colors[i * 4 + 3] = 1;
        offsets[i * 3] = px;
        offsets[i * 3 + 1] = 0;
        offsets[i * 3 + 2] = pz;
      }
    }
    const colorBuffer = device.createBuffer({ size: colors.byteLength, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    colorBuffer.write(colors);
    const offsetBuffer = device.createBuffer({ size: offsets.byteLength, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    offsetBuffer.write(offsets);

    const cube = Geometry.create(device, box(0.9, 0.9, 0.9));

    let t = 0;
    return {
      frame(pass, ctx2) {
        t += ctx2.dt;
        const cam = ctx2.camera;
        cam.center.set(0, 0.6, 0);
        cam.yaw += ctx2.dt * 0.05;
        cam.update();
        cameraBlock.setMat4("u_viewProj", cam.viewProjection);
        cameraBlock.flush();

        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.setVertexBuffer(0, cube.vertexBuffer);
        pass.setVertexBuffer(1, colorBuffer);
        pass.setVertexBuffer(2, offsetBuffer);
        if (!cube.indexBuffer || !cube.indexFormat) throw new Error("box 几何体缺少索引");
        pass.setIndexBuffer(cube.indexBuffer, cube.indexFormat);
        pass.drawIndexed(cube.indexCount, INSTANCE_COUNT);
      },
    };
  },
});

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
