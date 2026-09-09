/**
 * 三角形示例 —— 最小可运行示例：
 * 用最少的 API 跑通 后端选择 → 几何体上传 → 材质 → 逐帧绘制。
 */

import { bootDemo } from "../common/demo.js";
import { Geometry } from "../../src/render/Geometry.js";
import { triangle } from "../../src/render/primitives.js";
import { ColorMaterial } from "../../src/render/material.js";
import { Mesh } from "../../src/render/Mesh.js";
import { Color } from "../../src/math/color.js";
import { Mat4 } from "../../src/math/mat4.js";

bootDemo(
  {
    title: "三角形 · 最小示例（统一命令跑通 WebGL2 / WebGPU）",
    run(ctx) {
      const device = ctx.device;
      const geometry = Geometry.create(device, triangle());
      const mesh = new Mesh(geometry);
      // 2D 示例：不需要深度/剔除
      const material = new ColorMaterial(device, new Color(0.2, 0.7, 0.95, 1), { cullMode: "none", depth: false, label: "triangle" });

      // 模型空间即 NDC，用单位阵即可（无需相机）
      const identity = new Mat4();
      let time = 0;
      return {
        frame(pass) {
          time += ctx.dt;
          const pulse = Math.sin(time * 2.2) * 0.5 + 0.5;
          material.setColor(new Color(0.2 + 0.4 * pulse, 0.55 + 0.3 * pulse, 0.95, 1));
          mesh.model.setIdentity().rotateZ(Math.sin(time) * 0.25);
          material.beginFrame(identity);
          material.draw(pass, mesh);
        },
      };
    },
  },
  { depth: false },
);
