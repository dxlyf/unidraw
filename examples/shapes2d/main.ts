/**
 * 2D 绘制示例 —— 矩形 / 线 / 圆 / 椭圆 / 多边形（填充与描边）
 *
 * 演示点：
 * - 自定义 2D 着色器（position.xy + 顶点色），像素坐标 → 正交投影；
 * - 每帧把 2D 图元 CPU 侧三角化并合批为 1 个 draw（动态重建，便于动画）；
 * - 相同的代码跑 WebGL2 / WebGPU。
 */

import { bootDemo } from "../common/demo.js";
import { UniformBlock } from "../../src/render/UniformBlock.js";
import { Color } from "../../src/math/color.js";
import { Mat4 } from "../../src/math/mat4.js";
import { BufferUsage } from "../../src/gpu/types.js";
import type { Buffer } from "../../src/device/resources.js";
import type { Device } from "../../src/device/Device.js";
import type { RenderPassEncoder } from "../../src/command/encoder.js";
import { ColorWriteMask } from "../../src/device/descriptors.js";

// ---------------------------------------------------------------------------
// 2D 着色器（GLSL + WGSL）
// ---------------------------------------------------------------------------

const VS_GLSL = `#version 300 es
precision highp float;
layout(std140) uniform ViewBlock { mat4 u_viewProj; };
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a_color;
out vec4 v_color;
void main() {
  v_color = a_color;
  gl_Position = u_viewProj * vec4(a_pos, 0.0, 1.0);
}
`;

const FS_GLSL = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 fragColor;
void main() { fragColor = v_color; }
`;

const WGSL = `
struct ViewBlock { u_viewProj : mat4x4f, };
@group(0) @binding(0) var<uniform> view : ViewBlock;
struct VSIn {
  @location(0) a_pos : vec2f,
  @location(1) a_color : vec4f,
};
struct VSOut { @builtin(position) clip_pos : vec4f, @location(0) v_color : vec4f, };
@vertex fn vs_main(in : VSIn) -> VSOut {
  var out : VSOut;
  out.v_color = in.a_color;
  out.clip_pos = view.u_viewProj * vec4f(in.a_pos, 0.0, 1.0);
  return out;
}
struct FSIn { @builtin(position) clip_pos : vec4f, @location(0) v_color : vec4f, };
@fragment fn fs_main(in : FSIn) -> @location(0) vec4f { return in.v_color; }
`;

// ---------------------------------------------------------------------------
// CPU 侧三角化器（位置 + 顶点色，单交错顶点流：vec2 + vec4 = 24B）
// ---------------------------------------------------------------------------

type Pt = readonly [number, number];

class ShapeBatch {
  private device: Device;
  private color = new Color(1, 1, 1, 1);
  private verts: number[] = [];
  private idx: number[] = [];
  private vcount = 0;

  // GPU 常驻缓冲（容量不足时翻倍重建）
  private vcap = 16384;
  private icap = 65536;
  private vertexBuffer: Buffer | null = null;
  private indexBuffer: Buffer | null = null;

  constructor(device: Device) {
    this.device = device;
    this.ensureBuffers(this.vcap, this.icap);
  }

  private ensureBuffers(vcap: number, icap: number): void {
    if (this.vertexBuffer) this.vertexBuffer.destroy();
    if (this.indexBuffer) this.indexBuffer.destroy();
    this.vertexBuffer = this.device.createBuffer({ label: "2d-vertex", size: vcap * 24, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    this.indexBuffer = this.device.createBuffer({ label: "2d-index", size: icap * 2, usage: BufferUsage.INDEX | BufferUsage.COPY_DST });
  }

  /** 每帧开始：清空 CPU 累加器 */
  beginFrame(): void {
    this.verts.length = 0;
    this.idx.length = 0;
    this.vcount = 0;
  }

  setColor(color: Color): this {
    this.color = color;
    return this;
  }

  private emit(x: number, y: number): number {
    const c = this.color;
    this.verts.push(x, y, c.r, c.g, c.b, c.a);
    return this.vcount++;
  }

  private tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** 线段（宽度 lw，直角端帽） */
  line(ax: number, ay: number, bx: number, by: number, lw: number): void {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return;
    const hw = lw / 2;
    const nx = (-dy / len) * hw;
    const ny = (dx / len) * hw;
    const v0 = this.emit(ax + nx, ay + ny);
    const v1 = this.emit(ax - nx, ay - ny);
    const v2 = this.emit(bx - nx, by - ny);
    const v3 = this.emit(bx + nx, by + ny);
    this.tri(v0, v1, v2);
    this.tri(v0, v2, v3);
  }

  /** 折线（不闭合），可自由传入多个点 */
  polyline(pts: Pt[], lw: number): void {
    for (let i = 0; i < pts.length - 1; i++) {
      this.line(pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1], lw);
    }
  }

  /** 矩形填充 */
  fillRect(x: number, y: number, w: number, h: number): void {
    const v0 = this.emit(x, y);
    const v1 = this.emit(x + w, y);
    const v2 = this.emit(x + w, y + h);
    const v3 = this.emit(x, y + h);
    this.tri(v0, v1, v2);
    this.tri(v0, v2, v3);
  }

  /** 矩形描边 */
  strokeRect(x: number, y: number, w: number, h: number, lw: number): void {
    this.polyline([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], lw);
  }

  /** 凸多边形填充（对凹多边形请用 strokePoly） */
  fillPolygon(pts: Pt[]): void {
    if (pts.length < 3) return;
    const ids = pts.map(([x, y]) => this.emit(x, y));
    for (let i = 1; i < ids.length - 1; i++) this.tri(ids[0]!, ids[i]!, ids[i + 1]!);
  }

  /** 多边形描边（支持凹多边形 / 星形） */
  strokePolygon(pts: Pt[], lw: number, closed = true): void {
    const p = closed ? [...pts, pts[0]!] : pts;
    for (let i = 0; i < p.length - 1; i++) this.line(p[i]![0], p[i]![1], p[i + 1]![0], p[i + 1]![1], lw);
  }

  /** 圆/椭圆填充 */
  fillEllipse(cx: number, cy: number, rx: number, ry: number, segments = 96): void {
    if (rx <= 0 || ry <= 0) return;
    const center = this.emit(cx, cy);
    const rim: number[] = [];
    for (let i = 0; i < segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      rim.push(this.emit(cx + rx * Math.cos(t), cy + ry * Math.sin(t)));
    }
    for (let i = 0; i < segments; i++) {
      this.tri(center, rim[i]!, rim[(i + 1) % segments]!);
    }
  }

  /** 圆/椭圆描边 */
  strokeEllipse(cx: number, cy: number, rx: number, ry: number, lw: number, segments = 96): void {
    if (rx <= 0 || ry <= 0) return;
    const pts: Pt[] = [];
    for (let i = 0; i < segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
    }
    this.strokePolygon(pts, lw);
  }

  /** 常规多边形顶点（正多边形，旋转 radius 等） */
  static regular(n: number, cx: number, cy: number, r: number, rot = 0): Pt[] {
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const t = rot + (i / n) * Math.PI * 2;
      pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    return pts;
  }

  /** 星形顶点（2n 点，交替内外半径） */
  static star(n: number, cx: number, cy: number, outer: number, inner: number, rot = 0): Pt[] {
    const pts: Pt[] = [];
    for (let i = 0; i < n * 2; i++) {
      const t = rot + (i / (n * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? outer : inner;
      pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    return pts;
  }

  /** 每帧末尾：上传并返回 draw 参数 */
  upload(): { vertexBuffer: Buffer; indexBuffer: Buffer; indexCount: number } {
    const vertCount = this.verts.length / 6;
    if (vertCount > this.vcap) {
      while (vertCount > this.vcap) this.vcap *= 2;
      this.icap = Math.max(this.icap, this.idx.length * 2 + 8);
      this.ensureBuffers(this.vcap, this.icap);
    }
    if (vertCount > 0xffff) throw new Error("2D 批顶点数超过 uint16 上限");
    const vertexData = new Float32Array(this.verts);
    const indexData = new Uint16Array(this.idx);
    this.vertexBuffer!.write(vertexData);
    this.indexBuffer!.write(indexData);
    return { vertexBuffer: this.vertexBuffer!, indexBuffer: this.indexBuffer!, indexCount: indexData.length };
  }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

bootDemo(
  {
    title: "2D 绘制 · 矩形 / 线 / 圆 / 椭圆 / 多边形",
    run(ctx) {
      const device = ctx.device;
      const batch = new ShapeBatch(device);

      const program = device.createProgram({ label: "2d", glsl: { vertex: VS_GLSL, fragment: FS_GLSL }, wgsl: { code: WGSL } });
      const layout = device.createBindGroupLayout({
        entries: [{ binding: 0, type: "uniform-buffer", visibility: 1, name: "ViewBlock" }],
      });
      const pipeline = device.createRenderPipeline({
        label: "2d-pipe",
        program,
        bindGroupLayouts: [layout],
        vertex: {
          buffers: [
            {
              arrayStride: 24,
              attributes: [
                { location: 0, format: "float32x2", offset: 0 },
                { location: 1, format: "float32x4", offset: 8 },
              ],
            },
          ],
        },
        primitive: { topology: "triangle-list", cullMode: "none", frontFace: "ccw" },
        targets: [
          {
            format: device.canvasFormat()!,
            writeMask: ColorWriteMask.ALL,
            blend: {
              color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
            },
          },
        ],
      });
      const viewBlock = new UniformBlock(device, { label: "2d-view", fields: [{ name: "u_viewProj", type: "mat4" }] });
      const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: viewBlock.buffer }] });

      const C = {
        red: () => new Color().setHex("#ff5c7a"),
        blue: () => new Color().setHex("#5aa0ff"),
        green: () => new Color().setHex("#3dd68c"),
        orange: () => new Color().setHex("#ff9a3d"),
        purple: () => new Color().setHex("#b07cff"),
        cyan: () => new Color().setHex("#35d7ee"),
        yellow: () => new Color().setHex("#f5d02e"),
        white: () => new Color(0.92, 0.94, 0.98, 1),
      };

      let time = 0;
      return {
        frame(pass: RenderPassEncoder, ctx2) {
          time += ctx2.dt;
          const w = Math.max(2, ctx2.width);
          const h = Math.max(2, ctx2.height);
          const s = Math.min(w, h);
          const cx = w / 2;
          const cy = h / 2;

          // 像素坐标（原点左上）→ NDC 的正交矩阵
          viewBlock.setMat4("u_viewProj", Mat4.ortho(0, w, h, 0, -1, 1));
          viewBlock.flush();

          batch.beginFrame();

          // ---- 背景细网格线 ----
          const grid = s / 8;
          batch.setColor(new Color(1, 1, 1, 0.05));
          for (let x = cx - s; x <= cx + s; x += grid) batch.line(x, cy - s, x, cy + s, 1);
          for (let y = cy - s; y <= cy + s; y += grid) batch.line(cx - s, y, cx + s, y, 1);

          const lw = Math.max(1, s * 0.008);

          // ---- 矩形（左列）----
          const rectW = s * 0.42;
          const rectH = rectW * 0.66;
          const rx = cx - s * 0.88;
          const ry = cy - rectH / 2;
          batch.setColor(C.blue());
          batch.strokeRect(rx, ry, rectW, rectH, lw);
          batch.setColor(C.orange());
          batch.fillRect(rx + rectW * 0.14, ry + rectH * 0.2, rectW * 0.3, rectH * 0.3);

          // 动画：一个移动的小矩形
          const bx = rx + (Math.sin(time * 1.3) * 0.5 + 0.5) * rectW * 0.5;
          batch.setColor(C.yellow());
          batch.fillRect(bx, ry + rectH * 0.62, lw * 3, lw * 3);

          // ---- 线（中列）----
          const lx0 = cx - s * 0.28;
          const lx1 = cx + s * 0.28;
          batch.setColor(C.red());
          batch.line(lx0, cy - s * 0.34, lx1, cy - s * 0.34, lw * 2); // 粗横线
          batch.line(lx0, cy - s * 0.34, cx, cy + s * 0.34, lw * 0.6); // 细斜线
          batch.line(cx, cy + s * 0.34, lx1, cy - s * 0.34, lw * 0.6);
          batch.setColor(C.green());
          batch.line(lx0, cy - s * 0.3, cx, cy + s * 0.36, lw); // 折线
          batch.line(cx, cy + s * 0.36, lx1, cy + s * 0.1, lw);

          // ---- 圆（右上）----
          const ccx = cx + s * 0.72;
          const ccy = cy - s * 0.36;
          const cr = s * 0.18;
          const fillC = C.red();
          fillC.a = 0.55;
          batch.setColor(fillC);
          batch.fillEllipse(ccx, ccy, cr, cr, 128);
          batch.setColor(C.white());
          batch.strokeEllipse(ccx, ccy, cr, cr, lw, 128);

          // 轨道小圆
          const ot = time * 1.6;
          batch.setColor(C.cyan());
          batch.fillEllipse(ccx + Math.cos(ot) * cr * 1.5, ccy + Math.sin(ot) * cr * 1.5, lw * 2.4, lw * 2.4, 32);

          // ---- 椭圆（右下）----
          const ecx = cx + s * 0.55;
          const ecy = cy + s * 0.38;
          const erx = s * 0.24;
          const ery = s * 0.13;
          const fillE = C.purple();
          fillE.a = 0.6;
          batch.setColor(fillE);
          batch.fillEllipse(ecx, ecy, erx, ery, 96);
          batch.setColor(C.orange());
          batch.strokeEllipse(ecx + erx * 0.5, ecy + ery * 0.6, erx * 0.45, ery * 0.5, lw, 64);

          // ---- 多边形（左下：正五边形填充 + 六边形描边 + 旋转星形）----
          const px0 = cx - s * 0.7;
          const py0 = cy + s * 0.4;
          const fillP = C.green();
          fillP.a = 0.8;
          batch.setColor(fillP);
          batch.fillPolygon(ShapeBatch.regular(5, px0, py0, s * 0.15, -Math.PI / 2));
          batch.setColor(C.cyan());
          batch.strokePolygon(ShapeBatch.regular(6, px0 + s * 0.34, py0 - s * 0.04, s * 0.12), lw, true);
          // 旋转的七角星（描边，支持凹多边形）
          const star = ShapeBatch.star(7, px0 - s * 0.02, py0 + s * 0.3, s * 0.12, s * 0.055, time * 0.7);
          batch.setColor(C.yellow());
          batch.strokePolygon(star, lw * 0.7, true);

          const draw = batch.upload();
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, group);
          pass.setVertexBuffer(0, draw.vertexBuffer);
          pass.setIndexBuffer(draw.indexBuffer, "uint16");
          pass.drawIndexed(draw.indexCount);
        },
      };
    },
  },
  { depth: false },
);
