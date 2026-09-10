/**
 * 性能示例 · 大量独立 draw 调用
 *
 * 目的：观察「每物体一次 draw」的 CPU 开销（含 UBO 提交 + 顶点/索引绑定 + 状态设置）。
 * 档位：500 / 1k / 2k / 4k / 6k / 10k / 20k / 40k 个旋转立方体（12 三角形/个）。
 *
 * **默认不自动换档**：点击档位、或用 ←/→ 切换后停留在该档（空格恢复自动循环）。
 * 面板里的 µs/draw 就是每 draw 的固定成本：它决定了「一帧能画多少个物体」。
 *
 * 框架侧为这条路径做的优化（都体现在这个示例上）：
 * - 模型矩阵走**动态偏移环形 UBO**：一个材质实例 + 一条管线 + 一个 bind group 画任意多物体，
 *   逐 draw 只写 64B 到 CPU 暂存，**提交前合并成一次 buffer 上传**（WebGPU 上尤其关键）；
 * - 渲染通道编码器对冗余状态去重（同管线/同顶点流/同索引流不再重复产生命令）；
 * - WebGL2 后端缓存当前 VAO，避免每个 draw 重新构造 key/重绑。
 */

import { bootBench, type BenchContext, type BenchScene } from "../common/bench.js";
import { ColorMaterial } from "../../src/render/material.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box } from "../../src/render/primitives.js";
import { Mesh } from "../../src/render/Mesh.js";
import { Color } from "../../src/math/color.js";
import { clamp } from "../../src/math/mmath.js";

const PALETTE = ["#ff5c8a", "#4c8dff", "#3dd68c", "#f5c518", "#b07cff", "#22d3ee", "#ff8f3d"].map((h) => new Color().setHex(h));

const COUNTS = [500, 1000, 2000, 4000, 6000, 10000, 20000, 40000];
const TRI_PER_BOX = 12; // box() 36 索引

bootBench({
  title: "性能 · draw call 压力（独立立方体 × N）",
  presets: COUNTS.map((count) => ({
    name: `${count.toLocaleString()} draws`,
    create(ctx: BenchContext): BenchScene {
      const device = ctx.device;
      const geometry = Geometry.create(device, box(0.55, 0.55, 0.55));

      // 少量共享材质（4 个颜色分组，模拟真实场景的状态切换）
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
        status(avgMs) {
          const perDrawUs = avgMs > 0 ? (avgMs * 1000) / count : 0;
          const drawsPerSec = avgMs > 0 ? (count * 1000) / avgMs / 1e6 : 0;
          return (
            `draws=${count.toLocaleString()}  tris=${(count * TRI_PER_BOX).toLocaleString()}\n` +
            `每 draw：${perDrawUs.toFixed(2)} µs   （${drawsPerSec.toFixed(2)}M draws/s）\n` +
            `材质 ${materials.length} 个（共享管线/绑定组）· 同几何体`
          );
        },
      };
    },
  })),
});
