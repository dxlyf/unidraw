/**
 * 性能示例 · 三角形吞吐（高细分网格光栅化）
 *
 * 目的：观察顶点处理 / 光栅化吞吐。同样网格绘制 4 份（4 draw），
 * 档位按细分段放大三角形数量。
 * 读法：帧耗时与三角形数近似线性（纯 GPU 负载，CPU 侧仅 4 draw）。
 */

import { bootBench, type BenchContext, type BenchScene } from "../common/bench.js";
import { ColorMaterial } from "../../src/render/material.js";
import { Geometry, type GeometryData } from "../../src/render/Geometry.js";
import { sphere } from "../../src/render/primitives.js";
import { Mesh } from "../../src/render/Mesh.js";
import { Color } from "../../src/math/color.js";

const SEGS: [number, number][] = [
  [32, 16],
  [64, 32],
  [96, 48],
  [144, 72],
  [224, 112],
];
const COPIES = 4;
const LAYOUT = [
  { x: -2.1, z: 0 },
  { x: 0.7, z: -2.05 },
  { x: 0.7, z: 2.05 },
  { x: 3.5, z: 0 },
];

bootBench({
  title: "性能 · 三角形吞吐（细分球体 × 4）",
  presets: SEGS.map(([ws, hs]) => ({
    name: `${ws}×${hs} seg`,
    create(ctx: BenchContext): BenchScene {
      const device = ctx.device;
      const data: GeometryData = sphere(1.15, ws, hs);
      const geometry = Geometry.create(device, data);
      const trisPerMesh = data.indices!.length / 3;
      const totalTris = trisPerMesh * COPIES;

      const materials = [new ColorMaterial(device, new Color().setHex("#4c8dff"), { label: "tri-blue" }), new ColorMaterial(device, new Color().setHex("#22d3ee"), { label: "tri-cyan" })];
      const meshes: { mesh: Mesh; material: ColorMaterial }[] = [];
      LAYOUT.forEach((p, i) => {
        const mesh = new Mesh(geometry);
        mesh.model.translate(p.x, Math.sin(i * 1.7) * 0.4, p.z);
        meshes.push({ mesh, material: materials[i % materials.length]! });
      });
      ctx.camera.distance = 12;
      ctx.camera.center.set(0.8, 0, 0);
      // 视线更高一点，避免网格过密
      ctx.camera.pitch = -0.22;

      return {
        draw(pass, _time, ctx2) {
          const vp = ctx2.camera.viewProjection;
          for (const m of materials) m.beginFrame(vp);
          for (const { mesh, material } of meshes) {
            material.draw(pass, mesh);
          }
        },
        status() {
          return `draws=${meshes.length} · 每网格 ${trisPerMesh.toLocaleString()} tris\n总三角形 ≈ ${totalTris.toLocaleString()}\n顶点/网格 ≈ ${(geometry.vertexCount).toLocaleString()}`;
        },
      };
    },
  })),
});
