import type { Device } from "../device/Device.js";
import type { RenderPassEncoder } from "../command/encoder.js";
import type { Texture } from "../device/resources.js";
import type { BindGroup, BindGroupLayout, Buffer, RenderPipeline, Sampler } from "../device/resources.js";
import { ColorWriteMask } from "../device/descriptors.js";
import { UniformBlock } from "../render/UniformBlock.js";
import { Mat4 } from "../math/mat4.js";
import { BufferUsage } from "../gpu/types.js";
import type { PaintStyle } from "./style.js";
import { sampleStyle } from "./style.js";
import { Path2D } from "./path.js";
import { triangulateSimplePolygon } from "./triangulate.js";
import type { Pt2 } from "./matrix.js";
import { identityAffine, copyAffine, multiplyAffine, transformPoint } from "./matrix.js";
import { FLAT_FS_GLSL, FLAT_VS_GLSL, FLAT_WGSL, TEX_FS_GLSL, TEX_VS_GLSL, TEX_WGSL } from "./shaders.js";
import { TextRenderer } from "./text.js";
import type { Canvas2DOptions, DeviceRect, LineCap, LineJoin, Op, SavedState } from "./types.js";
import { DEFAULT_FONT } from "./types.js";
import { detectRectContour, intersectRects, lineIntersect, normalOffset, sameClip, unitDir } from "./geometry2d.js";

export class Canvas2D {
  private device: Device;
  private textRenderer: TextRenderer;

  // ---- 每帧几何缓冲（动态）与 op 顺序列表 ----
  private flatV: number[] = [];
  private flatI: number[] = [];
  private textV: number[] = [];
  private textI: number[] = [];
  private ops: Op[] = [];

  private flatVBuf: Buffer | null = null;
  private flatIBuf: Buffer | null = null;
  private textVBuf: Buffer | null = null;
  private textIBuf: Buffer | null = null;
  private flatCap = 1 << 13;
  private textCap = 1 << 12;

  private viewBlock!: UniformBlock;
  private flatPipeline!: RenderPipeline;
  private texPipeline!: RenderPipeline;
  private flatGroup!: BindGroup;
  private texLayout!: BindGroupLayout;
  private sampler!: Sampler;
  private glyphGroups = new WeakMap<Texture, BindGroup>();

  private viewW = 1;
  private viewH = 1;

  // ---- 状态 ----
  private path = new Path2D();
  private stack: SavedState[] = [];
  private state: SavedState = {
    ctm: identityAffine(),
    fillStyle: "#ffffff",
    strokeStyle: "#ffffff",
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    miterLimit: 10,
    font: DEFAULT_FONT,
    clip: null,
  };

  constructor(device: Device, options: Canvas2DOptions = {}) {
    this.device = device;
    if (options.vertexCapacity) {
      this.flatCap = Math.max(2048, options.vertexCapacity);
      this.textCap = Math.max(1024, options.vertexCapacity >> 1);
    }
    this.textRenderer = new TextRenderer(device);
    this.initResources();
  }

  private initResources(): void {
    const d = this.device;
    const canvasFormat = d.canvasFormat() ?? "rgba8unorm";
    this.viewBlock = new UniformBlock(d, { label: "2d-view", fields: [{ name: "u_viewProj", type: "mat4" }] });

    const blend = {
      color: { srcFactor: "src-alpha" as const, dstFactor: "one-minus-src-alpha" as const, operation: "add" as const },
      alpha: { srcFactor: "one" as const, dstFactor: "one-minus-src-alpha" as const, operation: "add" as const },
    };
    const target = { format: canvasFormat, writeMask: ColorWriteMask.ALL, blend };

    const flatLayout = d.createBindGroupLayout({
      entries: [{ binding: 0, type: "uniform-buffer", visibility: 1, name: "ViewBlock" }],
    });
    const flatProgram = d.createProgram({
      glsl: { vertex: FLAT_VS_GLSL, fragment: FLAT_FS_GLSL },
      wgsl: { code: FLAT_WGSL },
    });
    this.flatPipeline = d.createRenderPipeline({
      label: "2d-flat-pipe",
      program: flatProgram,
      bindGroupLayouts: [flatLayout],
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
      targets: [target],
    });
    this.flatGroup = d.createBindGroup({ layout: flatLayout, entries: [{ binding: 0, resource: this.viewBlock.buffer }] });

    this.texLayout = d.createBindGroupLayout({
      entries: [
        { binding: 0, type: "uniform-buffer", visibility: 1, name: "ViewBlock" },
        { binding: 1, type: "texture", visibility: 2, name: "u_tex" },
        { binding: 2, type: "sampler", visibility: 2, name: "u_texSampler" },
      ],
    });
    const texProgram = d.createProgram({
      glsl: { vertex: TEX_VS_GLSL, fragment: TEX_FS_GLSL },
      wgsl: { code: TEX_WGSL },
    });
    this.texPipeline = d.createRenderPipeline({
      label: "2d-tex-pipe",
      program: texProgram,
      bindGroupLayouts: [this.texLayout],
      vertex: {
        buffers: [
          {
            arrayStride: 32,
            attributes: [
              { location: 0, format: "float32x2", offset: 0 },
              { location: 1, format: "float32x2", offset: 8 },
              { location: 2, format: "float32x4", offset: 16 },
            ],
          },
        ],
      },
      primitive: { topology: "triangle-list", cullMode: "none", frontFace: "ccw" },
      targets: [target],
    });
    this.sampler = d.createSampler({
      label: "2d-tex-sampler",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "nearest",
      mips: false,
    });
  }

  // ======================================================================
  // 状态访问器
  // ======================================================================

  get fillStyle(): PaintStyle {
    return this.state.fillStyle;
  }
  set fillStyle(v: PaintStyle) {
    this.state.fillStyle = v;
  }
  get strokeStyle(): PaintStyle {
    return this.state.strokeStyle;
  }
  set strokeStyle(v: PaintStyle) {
    this.state.strokeStyle = v;
  }
  get globalAlpha(): number {
    return this.state.globalAlpha;
  }
  set globalAlpha(v: number) {
    this.state.globalAlpha = Math.max(0, Math.min(1, v));
  }
  get lineWidth(): number {
    return this.state.lineWidth;
  }
  set lineWidth(v: number) {
    this.state.lineWidth = Math.max(0.001, v);
  }
  get lineCap(): LineCap {
    return this.state.lineCap;
  }
  set lineCap(v: LineCap) {
    this.state.lineCap = v;
  }
  get lineJoin(): LineJoin {
    return this.state.lineJoin;
  }
  set lineJoin(v: LineJoin) {
    this.state.lineJoin = v;
  }
  get miterLimit(): number {
    return this.state.miterLimit;
  }
  set miterLimit(v: number) {
    this.state.miterLimit = v;
  }
  get font(): string {
    return this.state.font;
  }
  set font(v: string) {
    this.state.font = v;
  }

  save(): void {
    this.stack.push({
      ctm: copyAffine(this.state.ctm),
      fillStyle: this.state.fillStyle,
      strokeStyle: this.state.strokeStyle,
      globalAlpha: this.state.globalAlpha,
      lineWidth: this.state.lineWidth,
      lineCap: this.state.lineCap,
      lineJoin: this.state.lineJoin,
      miterLimit: this.state.miterLimit,
      font: this.state.font,
      clip: this.state.clip ? { ...this.state.clip } : null,
    });
  }

  restore(): void {
    const s = this.stack.pop();
    if (!s) throw new Error("[unidraw] Canvas2D.restore() 与 save() 不匹配");
    this.state = { ...s };
  }

  translate(tx: number, ty: number): this {
    multiplyAffine(this.state.ctm, { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }, this.state.ctm);
    return this;
  }
  scale(sx: number, sy = sx): this {
    multiplyAffine(this.state.ctm, { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }, this.state.ctm);
    return this;
  }
  rotate(rad: number): this {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    multiplyAffine(this.state.ctm, { a: c, b: s, c: -s, d: c, e: 0, f: 0 }, this.state.ctm);
    return this;
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): this {
    this.state.ctm = { a, b, c, d, e, f };
    return this;
  }
  resetTransform(): this {
    this.state.ctm = identityAffine();
    return this;
  }

  // ======================================================================
  // 路径委托
  // ======================================================================

  beginPath(): this {
    this.path.begin();
    return this;
  }
  moveTo(x: number, y: number): this {
    this.path.moveTo(x, y);
    return this;
  }
  lineTo(x: number, y: number): this {
    this.path.lineTo(x, y);
    return this;
  }
  quadraticCurveTo(x1: number, y1: number, x: number, y: number): this {
    this.path.quadraticCurveTo(x1, y1, x, y);
    return this;
  }
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    this.path.bezierCurveTo(x1, y1, x2, y2, x, y);
    return this;
  }
  arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw = false): this {
    this.path.arc(cx, cy, r, a0, a1, ccw);
    return this;
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): this {
    this.path.arcTo(x1, y1, x2, y2, r);
    return this;
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false): this {
    this.path.ellipse(cx, cy, rx, ry, rot, a0, a1, ccw);
    return this;
  }
  rect(x: number, y: number, w: number, h: number): this {
    this.path.rect(x, y, w, h);
    return this;
  }
  roundRect(x: number, y: number, w: number, h: number, r: number | [number, number, number, number]): this {
    this.path.roundRect(x, y, w, h, r);
    return this;
  }
  closePath(): this {
    this.path.closePath();
    return this;
  }

  // ======================================================================
  // 帧
  // ======================================================================

  begin(): this {
    this.flatV.length = 0;
    this.flatI.length = 0;
    this.textV.length = 0;
    this.textI.length = 0;
    this.ops.length = 0;
    this.stack.length = 0;
    // 裁剪是“每帧重新建立”的状态：避免上一帧异常/未 restore 时把后续整帧都裁掉
    this.state.clip = null;
    this.path.begin();
    return this;
  }

  setViewportSize(width: number, height: number): this {
    this.viewW = Math.max(1, width);
    this.viewH = Math.max(1, height);
    return this;
  }

  /** 提交本帧：先按 op 顺序补裁剪，再以索引子范围 draw */
  flush(pass: RenderPassEncoder, viewProj: Mat4): void {
    if (this.ops.length === 0) return;
    this.viewBlock.setMat4("u_viewProj", viewProj);
    this.viewBlock.flush();

    this.ensureCapacity();
    if (this.flatV.length > 0) {
      this.flatVBuf!.write(new Float32Array(this.flatV));
      this.flatIBuf!.write(new Uint16Array(this.flatI));
    }
    if (this.textV.length > 0) {
      this.textVBuf!.write(new Float32Array(this.textV));
      this.textIBuf!.write(new Uint16Array(this.textI));
    }

    let lastKind: "flat" | "text" | null = null;
    let lastClip: DeviceRect | null = null;
    let clipInit = false;

    for (const op of this.ops) {
      const c = op.clip;
      if (!clipInit || !sameClip(lastClip, c)) {
        if (c) pass.setScissorRect(c.x, c.y, c.w, c.h);
        else pass.setScissorRect(0, 0, this.viewW, this.viewH);
        lastClip = c;
        clipInit = true;
      }
      if (lastKind !== op.kind) {
        lastKind = op.kind;
        if (op.kind === "flat") {
          pass.setPipeline(this.flatPipeline);
          pass.setBindGroup(0, this.flatGroup);
          if (this.flatVBuf && this.flatIBuf) {
            pass.setVertexBuffer(0, this.flatVBuf);
            pass.setIndexBuffer(this.flatIBuf, "uint16");
          }
        } else {
          pass.setPipeline(this.texPipeline);
          pass.setBindGroup(0, this.glyphGroup(op.texture));
          if (this.textVBuf && this.textIBuf) {
            pass.setVertexBuffer(0, this.textVBuf);
            pass.setIndexBuffer(this.textIBuf, "uint16");
          }
        }
      }
      const n = op.iEnd - op.iStart;
      if (n > 0) pass.drawIndexed(n, 1, op.iStart, 0, 0);
    }
  }

  private ensureCapacity(): void {
    const flatVertCount = this.flatV.length / 6;
    if (flatVertCount > this.flatCap) {
      while (this.flatCap < flatVertCount) this.flatCap *= 2;
      this.freeBuffers("flat");
    }
    const textVertCount = this.textV.length / 8;
    if (textVertCount > this.textCap) {
      while (this.textCap < textVertCount) this.textCap *= 2;
      this.freeBuffers("text");
    }
    if (!this.flatVBuf && flatVertCount > 0) {
      this.flatVBuf = this.device.createBuffer({ size: this.flatCap * 24, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
      this.flatIBuf = this.device.createBuffer({ size: this.flatCap * 3 * 2, usage: BufferUsage.INDEX | BufferUsage.COPY_DST });
    }
    if (!this.textVBuf && textVertCount > 0) {
      this.textVBuf = this.device.createBuffer({ size: this.textCap * 32, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
      this.textIBuf = this.device.createBuffer({ size: this.textCap * 3 * 2, usage: BufferUsage.INDEX | BufferUsage.COPY_DST });
    }
  }

  private freeBuffers(kind: "flat" | "text"): void {
    if (kind === "flat") {
      this.flatVBuf?.destroy();
      this.flatIBuf?.destroy();
      this.flatVBuf = null;
      this.flatIBuf = null;
    } else {
      this.textVBuf?.destroy();
      this.textIBuf?.destroy();
      this.textVBuf = null;
      this.textIBuf = null;
    }
  }

  private glyphGroup(texture: Texture): BindGroup {
    let g = this.glyphGroups.get(texture);
    if (!g) {
      g = this.device.createBindGroup({
        layout: this.texLayout,
        entries: [
          { binding: 0, resource: this.viewBlock.buffer },
          { binding: 1, resource: texture.view() },
          { binding: 2, resource: this.sampler },
        ],
      });
      this.glyphGroups.set(texture, g);
    }
    return g;
  }

  // ======================================================================
  // 顶点发射
  // ======================================================================

  private devPt(x: number, y: number): { x: number; y: number } {
    return transformPoint(this.state.ctm, x, y, { x: 0, y: 0 });
  }

  private pushFlat(ux: number, uy: number): number {
    const c = sampleStyle(this.state.fillStyle, ux, uy);
    const p = this.devPt(ux, uy);
    const v = this.flatV.length / 6;
    this.flatV.push(p.x, p.y, c.r, c.g, c.b, c.a * this.state.globalAlpha);
    return v;
  }

  private pushFlatStyle(ux: number, uy: number, style: PaintStyle): number {
    const c = sampleStyle(style, ux, uy);
    const p = this.devPt(ux, uy);
    const v = this.flatV.length / 6;
    this.flatV.push(p.x, p.y, c.r, c.g, c.b, c.a * this.state.globalAlpha);
    return v;
  }

  private pushTextV(ux: number, uy: number, u: number, v: number, style: PaintStyle): number {
    const c = sampleStyle(style, ux, uy);
    const p = this.devPt(ux, uy);
    const id = this.textV.length / 8;
    this.textV.push(p.x, p.y, u, v, c.r, c.g, c.b, c.a * this.state.globalAlpha);
    return id;
  }

  private pushTri(arr: "flat" | "text", a: number, b: number, c: number): void {
    (arr === "flat" ? this.flatI : this.textI).push(a, b, c);
  }

  private recordFlat(iStart: number): void {
    if (this.flatI.length > iStart) {
      this.ops.push({ kind: "flat", clip: this.state.clip ? { ...this.state.clip } : null, iStart, iEnd: this.flatI.length });
    }
  }

  // ======================================================================
  // 填充
  // ======================================================================

  fill(): void {
    const contours = this.path.flatten(0.2);
    if (contours.length === 0) return;
    const iStart = this.flatI.length;
    for (const contour of contours) {
      const pts = contour.points;
      if (pts.length < 3) continue;
      const tris = triangulateSimplePolygon(pts);
      if (!tris) continue;
      const ids: number[] = [];
      for (const k of tris) {
        const p = pts[k]!;
        ids.push(this.pushFlat(p[0], p[1]));
      }
      for (let i = 0; i < ids.length; i += 3) this.pushTri("flat", ids[i]!, ids[i + 1]!, ids[i + 2]!);
    }
    this.recordFlat(iStart);
  }

  // 便捷绘制
  fillRect(x: number, y: number, w: number, h: number): this {
    this.beginPath();
    this.rect(x, y, w, h);
    this.fill();
    return this;
  }
  strokeRect(x: number, y: number, w: number, h: number): this {
    this.beginPath();
    this.rect(x, y, w, h);
    this.stroke();
    return this;
  }
  fillCircle(cx: number, cy: number, r: number): this {
    this.beginPath();
    this.arc(cx, cy, r, 0, Math.PI * 2);
    this.fill();
    return this;
  }
  strokeCircle(cx: number, cy: number, r: number): this {
    this.beginPath();
    this.arc(cx, cy, r, 0, Math.PI * 2);
    this.stroke();
    return this;
  }

  // ======================================================================
  // 描边
  // ======================================================================

  stroke(): void {
    const contours = this.path.flatten(0.2);
    if (contours.length === 0) return;
    const style = this.state.strokeStyle;
    const hw = this.state.lineWidth / 2;
    const iStart = this.flatI.length;

    const quadRaw = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) => {
      const p = (x: number, y: number) => this.pushFlatStyle(x, y, style);
      const v0 = p(ax, ay);
      const v1 = p(bx, by);
      const v2 = p(cx, cy);
      const v3 = p(dx, dy);
      this.pushTri("flat", v0, v1, v2);
      this.pushTri("flat", v0, v2, v3);
    };

    // 单段矩形
    const segmentQuad = (ax: number, ay: number, bx: number, by: number, nx: number, ny: number) => {
      quadRaw(ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny);
    };

    const fan = (cx: number, cy: number, a0: number, a1: number) => {
      const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) / (Math.PI * 2)) * 64));
      const vc = this.pushFlatStyle(cx, cy, style);
      let prev = -1;
      for (let i = 0; i <= n; i++) {
        const t = a0 + ((a1 - a0) * i) / n;
        const v = this.pushFlatStyle(cx + Math.cos(t) * hw, cy + Math.sin(t) * hw, style);
        if (prev >= 0) this.pushTri("flat", vc, prev, v);
        prev = v;
      }
    };

    const cap = (px: number, py: number, dirx: number, diry: number, nxx: number, nyy: number) => {
      const capKind = this.state.lineCap;
      if (capKind === "butt") return;
      if (capKind === "square") {
        quadRaw(px + nxx, py + nyy, px + nxx + dirx * hw, py + nyy + diry * hw, px - nxx + dirx * hw, py - nyy + diry * hw, px - nxx, py - nyy);
        return;
      }
      // round：以端点为中心的半圆，朝向 dir
      const aDir = Math.atan2(diry, dirx);
      fan(px, py, aDir - Math.PI / 2, aDir + Math.PI / 2);
    };

    for (const contour of contours) {
      const pts = contour.points;
      const n = pts.length;
      if (n < 2) continue;
      if (contour.closed) {
        // 每段矩形
        for (let i = 0; i < n; i++) {
          const p = pts[i]!;
          const q = pts[(i + 1) % n]!;
          const off = normalOffset(p[0], p[1], q[0], q[1], hw);
          segmentQuad(p[0], p[1], q[0], q[1], off.x, off.y);
        }
        // 连接处
        for (let i = 0; i < n; i++) {
          this.joinCorner(pts[(i - 1 + n) % n]!, pts[i]!, pts[(i + 1) % n]!, hw);
        }
      } else {
        for (let i = 0; i < n - 1; i++) {
          const p = pts[i]!;
          const q = pts[i + 1]!;
          const off = normalOffset(p[0], p[1], q[0], q[1], hw);
          segmentQuad(p[0], p[1], q[0], q[1], off.x, off.y);
        }
        for (let i = 1; i < n - 1; i++) {
          this.joinCorner(pts[i - 1]!, pts[i]!, pts[i + 1]!, hw);
        }
        // 端点 cap
        const d0 = unitDir(pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1]);
        const off0 = normalOffset(pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1], hw);
        cap(pts[0]![0], pts[0]![1], -d0.x, -d0.y, off0.x, off0.y);
        const dLast = unitDir(pts[n - 2]![0], pts[n - 2]![1], pts[n - 1]![0], pts[n - 1]![1]);
        const offLast = normalOffset(pts[n - 2]![0], pts[n - 2]![1], pts[n - 1]![0], pts[n - 1]![1], hw);
        cap(pts[n - 1]![0], pts[n - 1]![1], dLast.x, dLast.y, offLast.x, offLast.y);
      }
    }
    this.recordFlat(iStart);
  }

  private joinCorner(p0: Pt2, p1: Pt2, p2: Pt2, hw: number): void {
    const e1x = p1[0] - p0[0];
    const e1y = p1[1] - p0[1];
    const e2x = p2[0] - p1[0];
    const e2y = p2[1] - p1[1];
    const l1 = Math.hypot(e1x, e1y);
    const l2 = Math.hypot(e2x, e2y);
    if (l1 < 1e-9 || l2 < 1e-9) return;
    const cross = e1x * e2y - e1y * e2x;
    const s = cross > 0 ? 1 : cross < 0 ? -1 : 0;
    if (s === 0) return;
    // 转角外侧单位法线：左转(s>0)取右法线；右转取左法线
    const outer = (ex: number, ey: number, inv: number) => (s > 0 ? { x: (ey / inv) * hw, y: (-ex / inv) * hw } : { x: (-ey / inv) * hw, y: (ex / inv) * hw });
    const o1 = outer(e1x, e1y, l1);
    const o2 = outer(e2x, e2y, l2);
    const ax = p1[0] + o1.x;
    const ay = p1[1] + o1.y;
    const bx = p1[0] + o2.x;
    const by = p1[1] + o2.y;

    const style = this.state.strokeStyle;
    if (this.state.lineJoin === "round") {
      const a0 = Math.atan2(ay - p1[1], ax - p1[0]);
      const a1 = Math.atan2(by - p1[1], bx - p1[0]);
      const fan = (cxa: number, cya: number) => {
        const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) / (Math.PI * 2)) * 64));
        const vc = this.pushFlatStyle(cxa, cya, style);
        let prev = -1;
        for (let i = 0; i <= n; i++) {
          const t = a0 + ((a1 - a0) * i) / n;
          const v = this.pushFlatStyle(p1[0] + Math.cos(t) * hw, p1[1] + Math.sin(t) * hw, style);
          if (prev >= 0) this.pushTri("flat", vc, prev, v);
          prev = v;
        }
      };
      fan(p1[0], p1[1]);
      return;
    }
    if (this.state.lineJoin === "miter") {
      const apex = lineIntersect(ax, ay, e1x, e1y, bx, by, e2x, e2y);
      if (apex) {
        const ratio = Math.hypot(apex.x - p1[0], apex.y - p1[1]) / hw;
        if (ratio <= this.state.miterLimit) {
          const va = this.pushFlatStyle(ax, ay, style);
          const vb = this.pushFlatStyle(bx, by, style);
          const vc = this.pushFlatStyle(apex.x, apex.y, style);
          this.pushTri("flat", va, vb, vc);
          return;
        }
      }
    }
    // bevel（含 miter 超限回退）
    const va = this.pushFlatStyle(ax, ay, style);
    const vb = this.pushFlatStyle(bx, by, style);
    const vc = this.pushFlatStyle(p1[0], p1[1], style);
    this.pushTri("flat", va, vb, vc);
  }

  // ======================================================================
  // 裁剪（轴对齐矩形；scissor 语义为设备空间）
  // ======================================================================

  clipRect(x: number, y: number, w: number, h: number): this {
    if (w <= 0 || h <= 0) {
      this.state.clip = { x: 0, y: 0, w: 0, h: 0 };
      return this;
    }
    const corners: Pt2[] = [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [cx, cy] of corners) {
      const p = this.devPt(cx, cy);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const rect: DeviceRect = { x: Math.round(minX), y: Math.round(minY), w: Math.round(maxX - minX), h: Math.round(maxY - minY) };
    this.state.clip = this.state.clip ? intersectRects(this.state.clip, rect) : rect;
    return this;
  }

  /** 当前路径须为轴对齐矩形，否则提示改用 clipRect */
  clip(): this {
    const r = detectRectContour(this.path);
    if (!r) {
      throw new Error("[unidraw] clip() 目前仅支持轴对齐矩形路径；请使用 clipRect(x, y, w, h)");
    }
    const rect: DeviceRect = { x: r[0], y: r[1], w: r[2], h: r[3] };
    this.state.clip = this.state.clip ? intersectRects(this.state.clip, rect) : rect;
    return this;
  }

  // ======================================================================
  // 文本
  // ======================================================================

  fillText(text: string, x: number, y: number): this {
    if (!text) return this;
    const glyph = this.textRenderer.getGlyph(text, this.state.font);
    const style = this.state.fillStyle;
    const iStart = this.textI.length;
    const left = x + glyph.left;
    const top = y - glyph.ascent;
    const v0 = this.pushTextV(left, top, 0, 0, style);
    const v1 = this.pushTextV(left + glyph.width, top, 1, 0, style);
    const v2 = this.pushTextV(left + glyph.width, top + glyph.height, 1, 1, style);
    const v3 = this.pushTextV(left, top + glyph.height, 0, 1, style);
    this.pushTri("text", v0, v1, v2);
    this.pushTri("text", v0, v2, v3);
    if (this.textI.length > iStart) {
      this.ops.push({ kind: "text", clip: this.state.clip ? { ...this.state.clip } : null, texture: glyph.texture, iStart, iEnd: this.textI.length });
    }
    return this;
  }

  clearTextCache(): void {
    this.textRenderer.clear();
  }
}
