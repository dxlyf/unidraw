/**
 * 三角形示例 —— 最小可运行示例：
 * 用最少的 API 跑通 后端选择 → 几何体上传 → 材质 → 逐帧绘制。
 *
 * 右上角留了一个**小**的 lil-gui 面板（`?gui=0` 关掉）：清屏色、三角形颜色/不透明度、
 * 颜色脉冲强度、自转速度、底部提示开关。最小示例刻意不堆参数，够用即止。
 */

import { bootDemo } from "../common/demo.js";
import { Geometry } from "../../src/render/Geometry.js";
import { triangle } from "../../src/render/primitives.js";
import { ColorMaterial } from "../../src/render/material.js";
import { Mesh } from "../../src/render/Mesh.js";
import { Color } from "../../src/math/color.js";
import { Mat4 } from "../../src/math/mat4.js";
import { applyUrlOverrides, createGui } from "../common/gui.js";

bootDemo(
  {
    title: "三角形 · 最小示例（统一命令跑通 WebGL2 / WebGPU）",
    run(ctx) {
      const device = ctx.device;
      const geometry = Geometry.create(device, triangle());
      const mesh = new Mesh(geometry);
      // 2D 示例：不需要深度/剔除；固定开 alphaBlend 才能让面板调不透明度（混合状态属于
      // 管线指纹，一开始就带上就不必在改参数时重建材质）
      const material = new ColorMaterial(device, new Color(0.2, 0.7, 0.95, 1), {
        cullMode: "none",
        depth: false,
        alphaBlend: true,
        label: "triangle",
      });

      const params = new URLSearchParams(location.search);

      // ---- 参数（URL 可覆盖；GUI 实时改） ------------------------------------
      const state = {
        background: "#0b0c10",
        color: "#33b3f2",
        alpha: 1,
        pulse: 1,
        spin: 1,
        showHint: true,
      };
      applyUrlOverrides(state, params);

      const baseColor = new Color().setHex(state.color);
      const drawColor = new Color();
      ctx.renderer.setBackground(state.background);

      // ---- 参数面板（lil-gui） ----------------------------------------------
      const gui = createGui({ title: "三角形（最小示例）", params, width: 232 });
      gui.addColor(state, "background").name("清屏色").onChange(() => ctx.renderer.setBackground(state.background));
      gui.addColor(state, "color").name("三角形颜色").onChange(() => baseColor.setHex(state.color));
      gui.add(state, "alpha", 0, 1, 0.01).name("不透明度");
      gui.add(state, "pulse", 0, 1, 0.01).name("脉冲强度");
      gui.add(state, "spin", 0, 3, 0.05).name("自转速度");
      gui.add(state, "showHint").name("显示底部提示").onChange(applyHint);

      // 底部提示条（bootDemo 创建）补一句面板开关 —— 左上角仍是标题/后端/fps 的 HUD
      const hint = document.querySelector<HTMLElement>(".hint");
      if (hint) hint.textContent += " · ?gui=0 关面板";
      function applyHint(): void {
        if (hint) hint.style.display = state.showHint ? "" : "none";
      }
      applyHint();

      // 模型空间即 NDC，用单位阵即可（无需相机）
      const identity = new Mat4();
      let time = 0;
      return {
        frame(pass) {
          time += ctx.dt;
          const pulse = Math.sin(time * 2.2) * 0.5 + 0.5;
          const gain = 1 + state.pulse * (pulse - 0.5) * 0.6;
          drawColor.set(baseColor.r * gain, baseColor.g * gain, baseColor.b * gain, state.alpha);
          material.setColor(drawColor);
          mesh.model.setIdentity().rotateZ(Math.sin(time * state.spin) * 0.25);
          material.beginFrame(identity);
          material.draw(pass, mesh);
        },
      };
    },
  },
  { depth: false },
);
