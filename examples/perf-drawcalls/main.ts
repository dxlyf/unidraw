/**
 * 性能示例 · 大量独立 draw 调用
 *
 * 目的：观察“每物体一次 draw（含 UBO 提交 + 顶点/索引绑定）”的 CPU 开销。
 * 档位：500 / 1000 / 2000 / 4000 / 6000 个旋转立方体（12 三角形/个）。
 * 读法：帧耗时上升曲线近似 = 每 draw 固定成本的线性叠加（含录制 + 提交 + GL/WebGPU 调用）。
 */

import { bootBench, type BenchContext, type BenchScene } from "../common/bench.js";
import { ColorMaterial } from "../../src/render/material.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box } from "../../src/render/primitives.js";
import { Mesh } from "../../src/render/Mesh.js";
import { Color } from "../../src/math/color.js";
import { clamp } from "../../src/math/mmath.js";

const PALETTE = ["#ff5c8a", "#4c8dff", "#3dd68c", "#f5c518", "#b07cff", "#22d3ee", "#ff8f3d"].map((h) => new Color().setHex(h));

const COUNTS = [500, 1000, 2000, 4000, 6000];
const TRI_PER_BOX = 12; // box() 36 索引

bootBench({
  title: "性能 · draw call 压力（独立立方体 × N）",
  presets: COUNTS.map((count) => ({
    name: `${count.toLocaleString()} draws`,
    create(ctx: BenchContext): BenchScene {
      const device = ctx.device;
      const geometry = Geometry.create(device, box(0.55, 0.55, 0.55));

      // 少量材质（共享 program 也按颜色分组，控制状态切换）
      const materials = PALETTE.slice(0, 4).map((c, i) => new ColorMaterial(device, c, { label: `dm-${i}` }));
      const groups = materials.map((material) => ({ material, meshes: [] as Mesh[] }));

      // 斐波那契螺旋布局：半径 ∝ √i，数量越多排得越密但视口不变
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < count; i++) {
        const ang = i * golden;
        const r = Math.sqrt(i + 1) * 1.15;
        const mesh = new Mesh(geometry);
        mesh.model
          .translate(Math.cos(ang) * r, (i % 5 - 2) * 0.9, Math.sin(ang) * r)
          .rotateY((i * 0.37) % 6.28)
          .rotateX((i * 0.13) % 1.2);
        groups[i % groups.length]!.meshes.push(mesh);
      }
      ctx.camera.distance = clamp(6 + Math.sqrt(count) * 0.75, 8, 90);
      ctx.camera.center.set(0, 0, 0);

      return {
        draw(pass, _time, ctx2) {
          const vp = ctx2.camera.viewProjection;
          for (const g of groups) {
            g.material.beginFrame(vp);
            for (const mesh of g.meshes) g.material.draw(pass, mesh);
          }
        },
        status() {
          return `draws=${count.toLocaleString()}  tris=${(count * TRI_PER_BOX).toLocaleString()}\n每 draw：1×UBO 提交 + 顶点/索引绑定`;
        },
      };
    },
  })),
});
