/**
 * 实例化示例 —— 展示“底层统一命令 API”：
 * 自定义双端着色器 + 多 slot 顶点缓冲（含 instance step）+ drawIndexed(instanceCount)。
 *
 * 右上角 lil-gui 面板：实例数量（X×Y 网格，buffer 预分配后只改 draw 数量与数据）、
 * 每实例自转速度、每实例缩放、颜色偏移、暂停、相机环绕；`?gui=0` 关面板（无头回归用）。
 *
 * 着色器侧新增一个 `u_params`（vec4）：x = 自转相位（按 `gl_InstanceID` /
 * `@builtin(instance_index)` 给每个实例一点差异），y = 每实例缩放。
 */

import { bootDemo } from "../common/demo.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box } from "../../src/render/primitives.js";
import { UniformBlock } from "../../src/render/UniformBlock.js";
import { BufferUsage } from "../../src/gpu/types.js";
import { applyUrlOverrides, createGui } from "../common/gui.js";
import type { VertexStateDescriptor } from "../../src/device/descriptors.js";

// ---------------------------------------------------------------------------
// 自定义着色器（GLSL + WGSL 双实现）
// ---------------------------------------------------------------------------

const INST_VERTEX_GLSL = `#version 300 es
precision highp float;
layout(std140) uniform CameraBlock {
  mat4 u_viewProj;
  vec4 u_params;
};
layout(location = 0) in vec3 a_position;
layout(location = 3) in vec4 a_color;
layout(location = 4) in vec3 a_offset;
out vec4 v_color;
void main() {
  v_color = a_color;
  // 每个实例的自转相位略有差异（gl_InstanceID 只在实例化绘制里有效）
  float phase = u_params.x * (1.0 + float(gl_InstanceID) * 0.1);
  float c = cos(phase);
  float s = sin(phase);
  // 先在实例本地空间缩放 + 绕 Y 旋转，再平移到实例偏移
  vec3 p = a_position * u_params.y;
  p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  gl_Position = u_viewProj * vec4(p + a_offset, 1.0);
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
  u_params : vec4f,
};
@group(0) @binding(0) var<uniform> camera : CameraBlock;

struct VSIn {
  @builtin(instance_index) instance : u32,
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
  let phase = camera.u_params.x * (1.0 + f32(in.instance) * 0.1);
  let c = cos(phase);
  let s = sin(phase);
  var p = in.a_position * camera.u_params.y;
  p = vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  out.clip_pos = camera.u_viewProj * vec4f(p + in.a_offset, 1.0);
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

/** 原本的 9×9 网格（默认外观与历史版本一致） */
const BASE_COLS = 9;
const BASE_ROWS = 9;
const BASE_COUNT = BASE_COLS * BASE_ROWS;
const SPACING = 1.15;
/** 实例缓冲预分配容量（面板只改 draw 数量，不重建 buffer） */
const MAX_INSTANCES = 512;

const params = new URLSearchParams(location.search);

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

    const cameraBlock = new UniformBlock(device, {
      label: "inst-camera",
      fields: [
        { name: "u_viewProj", type: "mat4" },
        { name: "u_params", type: "vec4" },
      ],
    });
    const group = device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: cameraBlock.buffer }],
    });

    // ---- 参数（URL 可覆盖；面板实时改） --------------------------------------
    const state = {
      /** 实例数量（默认 9×9=81，与历史版本一致） */
      count: BASE_COUNT,
      /** 每实例自转角速度（rad/s） */
      spinSpeed: 0.6,
      /** 每实例缩放倍率 */
      scale: 1,
      /** 颜色色相偏移（0~1） */
      hueShift: 0,
      /** 暂停动画（自转 + 相机环绕都停） */
      paused: false,
      /** 相机环绕 */
      autoOrbit: true,
    };
    applyUrlOverrides(state, params);

    // instance 数据（预分配到 MAX_INSTANCES，改数量只重写数据 + 改 draw 数量）
    const colors = new Float32Array(MAX_INSTANCES * 4);
    const offsets = new Float32Array(MAX_INSTANCES * 3);
    const colorBuffer = device.createBuffer({ size: colors.byteLength, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    const offsetBuffer = device.createBuffer({ size: offsets.byteLength, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });

    /** 当前网格形状与自动缩放（让不同实例数量都落在相机视野内） */
    let cols = BASE_COLS;
    let rows = BASE_ROWS;
    let autoScale = 1;

    /** 按当前实例数量重算 offset / color（网格居中，颜色为 HSL 近似） */
    function applyInstances(): void {
      const count = Math.max(1, Math.min(MAX_INSTANCES, Math.round(state.count)));
      state.count = count;
      cols = Math.max(1, Math.round(Math.sqrt(count)));
      rows = Math.max(1, Math.ceil(count / cols));
      // 数量变多时等比缩小间距与实例尺寸 → 整体铺开范围与默认 9×9 一致
      const density = Math.sqrt(BASE_COUNT / count);
      const spacing = SPACING * density;
      autoScale = density;

      for (let x = 0; x < cols; x++) {
        for (let z = 0; z < rows; z++) {
          const i = x * rows + z;
          if (i >= count) continue;
          const px = (x - (cols - 1) / 2) * spacing;
          const pz = (z - (rows - 1) / 2) * spacing;
          // HSL → RGB 近似（+ 面板的色相偏移）
          const hue = (((x / cols + z / rows) / 2 + state.hueShift) % 1 + 1) % 1;
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
      // 只上传前 count 个实例（缓冲容量固定，绘制数量由 drawIndexed 决定）
      colorBuffer.write(colors.subarray(0, count * 4));
      offsetBuffer.write(offsets.subarray(0, count * 3));
    }
    applyInstances();

    const cube = Geometry.create(device, box(0.9, 0.9, 0.9));

    // ---- 参数面板（lil-gui）：左上角是 HUD，面板在右上角 ----------------------
    const gui = createGui({ title: "实例化（自定义着色器）", params });
    gui
      .add(state, "count", 1, MAX_INSTANCES, 1)
      .name("实例数量")
      .onChange(() => {
        applyInstances();
        updateHud();
      });
    gui.add(state, "spinSpeed", 0, 4, 0.05).name("旋转速度");
    gui.add(state, "scale", 0.1, 3, 0.01).name("实例缩放");
    gui
      .add(state, "hueShift", 0, 1, 0.01)
      .name("颜色偏移")
      .onChange(() => {
        applyInstances();
        updateHud();
      });
    gui.add(state, "paused").name("暂停");
    gui.add(state, "autoOrbit").name("相机环绕");

    // HUD 上的实例数量要跟着面板变，所以在帧循环里刷新
    let hudInfo: HTMLElement | null = null;
    const hud = document.querySelector<HTMLElement>(".hud");
    if (hud) {
      hudInfo = document.createElement("div");
      const line = document.createElement("div");
      line.textContent = "面板      : 右上角 lil-gui 可调（?gui=0 关面板）";
      hud.appendChild(hudInfo);
      hud.appendChild(line);
    }
    function updateHud(): void {
      if (hudInfo) hudInfo.textContent = `实例数    : ${state.count}（${cols}×${rows} 网格）`;
    }
    updateHud();

    let phase = 0;
    return {
      frame(pass, ctx2) {
        const cam = ctx2.camera;
        cam.center.set(0, 0.6, 0);
        if (!state.paused) {
          phase += ctx2.dt * state.spinSpeed;
          if (state.autoOrbit) cam.yaw += ctx2.dt * 0.05;
        }
        cam.update();
        cameraBlock.setMat4("u_viewProj", cam.viewProjection);
        cameraBlock.setVec4("u_params", phase, state.scale * autoScale, 0, 0);
        cameraBlock.flush();

        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.setVertexBuffer(0, cube.vertexBuffer);
        pass.setVertexBuffer(1, colorBuffer);
        pass.setVertexBuffer(2, offsetBuffer);
        if (!cube.indexBuffer || !cube.indexFormat) throw new Error("box 几何体缺少索引");
        pass.setIndexBuffer(cube.indexBuffer, cube.indexFormat);
        pass.drawIndexed(cube.indexCount, state.count);
      },
    };
  },
});

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
