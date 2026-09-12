/**
 * 2D 绘制示例（框架级 Canvas2D）
 *
 * 展示：矩形/圆角矩形、直线、圆与圆弧、椭圆、贝塞尔曲线、多边形
 * （含凹多边形）填充与描边、线性渐变、全局透明度、仿射变换 + save/restore、
 * 文本、矩形裁剪（层级）。
 *
 * 右上角 lil-gui 面板：图形数量（花瓣）/ 线宽倍率 / 填充·描边开关 / 星形颜色 /
 * 是否显示网格，`?gui=0` 关面板（无头回归用）。
 */

import { bootDemo } from "../common/demo.js";
import { Canvas2D, LinearGradient } from "../../src/render2d/index.js";
import { applyUrlOverrides, createGui } from "../common/gui.js";

const params = new URLSearchParams(location.search);

const C = {
  red: "#ff5c7a",
  blue: "#5aa0ff",
  green: "#3dd68c",
  orange: "#ff9a3d",
  purple: "#b07cff",
  cyan: "#35d7ee",
  yellow: "#f5d02e",
  white: "#f2f5ff",
  dim: "#8b93a7",
};

bootDemo(
  {
    title: "2D 绘制 · 完整能力（路径/曲线/渐变/变换/文本/裁剪）",
    run(ctx) {
      const device = ctx.device;
      const c2d = new Canvas2D(device);
      let t = 0;
      // ?freeze：冻结动画，用于区分“动画问题”还是“渲染/驱动问题”
      const freeze = params.has("freeze");

      // ---- 参数（URL 可覆盖；面板实时改） ------------------------------------
      const state = {
        /** 变换演示里的花瓣（旋转矩形）数量 */
        shapeCount: 8,
        /** 所有路径线宽的统一倍率 */
        lineWidthScale: 1,
        /** 路径填充开关 */
        fill: true,
        /** 路径描边开关 */
        stroke: true,
        /** 星形（凹多边形）填充色 */
        color: C.yellow,
        /** 背景网格（1px 参考网格） */
        grid: true,
        /** 文字/圆角矩形的阴影（shadowBlur 图层） */
        shadow: true,
        /** 覆盖矩形用 overlay（需要「目标当纹理」的图层模式） */
        blend: true,
        /** 虚线描边 */
        dash: true,
      };
      applyUrlOverrides(state, params);

      // 面板开关直接决定要不要提交 fill()/stroke()（图形本身照常构建路径）
      const fillPath = (): void => {
        if (state.fill) c2d.fill();
      };
      const strokePath = (): void => {
        if (state.stroke) c2d.stroke();
      };

      // ---- 参数面板（lil-gui）：与左上角 HUD 分工，面板在右上角 -----------------
      const gui = createGui({ title: "2D 绘制参数", params });
      gui.add(state, "shapeCount", 3, 16, 1).name("图形数量（花瓣）");
      gui.add(state, "lineWidthScale", 0.2, 4, 0.05).name("线宽倍率");
      gui.add(state, "fill").name("填充（路径）");
      gui.add(state, "stroke").name("描边（路径）");
      gui.addColor(state, "color").name("星形颜色");
      gui.add(state, "grid").name("显示网格");
      gui.add(state,'shadow').name('显示阴影')


      const hud = document.querySelector<HTMLElement>(".hud");
      if (hud) {
        const line = document.createElement("div");
        line.textContent = "面板      : 右上角 lil-gui 可调（?gui=0 关面板）";
        hud.appendChild(line);
      }

      return {
        frame(pass, ctx2) {
          if (!freeze) t += ctx2.dt;
          const w = Math.max(2, ctx2.width);
          const h = Math.max(2, ctx2.height);
          const s = Math.min(w, h);


          c2d.setViewportSize(w, h);
          c2d.begin();

          const label = (text: string, x: number, y: number, size = 15) => {
            c2d.font = `600 ${size}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
            c2d.fillStyle = C.dim;
            c2d.fillText(text, x, y);
          };

          // ============ 一、矩形 / 圆角矩形（左列） ============
          {
            const x0 = w * 0.045;
            const y0 = h * 0.06;
            const box = s * 0.27;
            label("矩形 / 圆角矩形 / 渐变", x0, y0);
            const gy = new LinearGradient(x0, y0 + s * 0.02, x0 + box, y0 + s * 0.02);
            gy.addColorStop(0, C.purple);
            gy.addColorStop(0.5, C.blue);
            gy.addColorStop(1, C.cyan);
            c2d.fillStyle = gy;
            c2d.beginPath();
            c2d.roundRect(x0, y0 + s * 0.03, box, box * 0.42, s * 0.03);
            fillPath();

            c2d.strokeStyle = C.white;
            c2d.lineWidth = Math.max(1.5, s * 0.006) * state.lineWidthScale;
            c2d.lineJoin = "round";
            c2d.beginPath();
            c2d.rect(x0, y0 + box * 0.5, box * 0.42, box * 0.42);
            strokePath();

            c2d.fillStyle = C.orange;
            c2d.globalAlpha = 0.85;
            const bw = box * 0.42;
            c2d.beginPath();
            c2d.roundRect(x0 + box * 0.55, y0 + box * 0.5, bw, bw, [bw * 0.5, bw * 0.12, bw * 0.12, bw * 0.5]);
            fillPath();
            c2d.globalAlpha = 1;

            // 动画：移动小圆点（变换演示的基础）
            const dotX = x0 + box + Math.sin(t * 1.4) * box * 0.25;
            const dotY = y0 + box * 0.75 + Math.cos(t * 1.1) * box * 0.12;
            c2d.fillStyle = C.yellow;
            c2d.beginPath();
            c2d.arc(dotX, dotY, Math.max(2, s * 0.01), 0, Math.PI * 2);
            fillPath();
          }

          // ============ 二、贝塞尔 / 弧线（中列） ============
          {
            const x0 = w * 0.05 + s * 0.33;
            const y0 = h * 0.06;
            const box = s * 0.27;
            label("贝塞尔 / 弧线 / 椭圆", x0, y0);

            // 三次贝塞尔心形路径（描边）
            c2d.strokeStyle = C.red;
            c2d.lineWidth = Math.max(2, s * 0.008) * state.lineWidthScale;
            c2d.lineJoin = "round";
            c2d.beginPath();
            const hx = x0 + box * 0.32;
            const hy = y0 + box * 0.52;
            const scale = box * 0.52;
            c2d.moveTo(hx, hy + scale * 0.2);
            c2d.bezierCurveTo(hx - scale * 0.9, hy - scale * 0.5, hx - scale * 0.5, hy - scale * 1.05, hx, hy - scale * 0.42);
            c2d.bezierCurveTo(hx + scale * 0.5, hy - scale * 1.05, hx + scale * 0.9, hy - scale * 0.5, hx, hy + scale * 0.2);
            c2d.closePath();
            strokePath();

            // 圆弧（笑脸弧）与二次曲线
            c2d.strokeStyle = C.cyan;
            c2d.lineWidth = Math.max(2, s * 0.006) * state.lineWidthScale;
            c2d.beginPath();
            c2d.arc(x0 + box * 0.78, hy + scale * 0.4, scale * 0.16, Math.PI * 0.1, Math.PI * 0.9, false);
            strokePath();

            c2d.strokeStyle = C.green;
            c2d.beginPath();
            c2d.moveTo(x0 + box * 0.72, y0 + box * 0.15);
            c2d.quadraticCurveTo(x0 + box * 0.95, y0 - box * 0.1, x0 + box * 1.05, y0 + box * 0.28);
            strokePath();

            // 旋转椭圆
            c2d.fillStyle = C.purple;
            c2d.globalAlpha = 0.75;
            c2d.beginPath();
            c2d.ellipse(x0 + box * 0.15, y0 + box * 0.92, box * 0.13, box * 0.06, 0.4 + t * 0.3, 0, Math.PI * 2);
            fillPath();
            c2d.globalAlpha = 1;
          }

          // ============ 三、多边形 / 变换矩阵（右上） ============
          {
            const x0 = w * 0.05 + s * 0.66;
            const y0 = h * 0.06;
            const box = s * 0.24;
            label("多边形 / 变换 / save·restore", x0, y0);
            // 凹多边形（星形）填充：耳切法
            const star = (cx: number, cy: number, rOut: number, rIn: number, rot: number) => {
              c2d.beginPath();
              for (let i = 0; i < 10; i++) {
                const r = i % 2 === 0 ? rOut : rIn;
                const a = rot + (i / 10) * Math.PI * 2;
                if (i === 0) c2d.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
                else c2d.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
              }
              c2d.closePath();
            };
            star(x0 + box * 0.22, y0 + box * 0.45, box * 0.2, box * 0.1, t * 0.6);
            c2d.fillStyle = state.color;
            fillPath();
            star(x0 + box * 0.22, y0 + box * 0.45, box * 0.2, box * 0.1, t * 0.6);
            c2d.strokeStyle = C.white;
            c2d.lineWidth = Math.max(1.5, s * 0.004) * state.lineWidthScale;
            strokePath();

            // 变换矩阵：围绕一点旋转+缩放的若干矩形（层叠演示 save/restore）
            const pcx = x0 + box * 0.76;
            const pcy = y0 + box * 0.55;
            const petals = ["#ff5c7a", "#ff9a3d", "#f5d02e", "#3dd68c", "#35d7ee", "#5aa0ff", "#b07cff", "#ff8fb3"];
            const petalCount = Math.max(1, Math.round(state.shapeCount));
            c2d.save();
            c2d.translate(pcx, pcy);
            for (let i = 0; i < petalCount; i++) {
              c2d.save();
              c2d.rotate(t * 0.4 + (i / petalCount) * Math.PI * 2);
              c2d.scale(1 - (i * 0.06 * 8) / petalCount);
              c2d.fillStyle = petals[i % petals.length]!;
              c2d.beginPath();
              c2d.rect(-box * 0.1, -box * 0.1, box * 0.2, box * 0.2);
              fillPath();
              c2d.restore();
            }
            c2d.restore();
          }

          // ============ 四、文本（左下） ============
          {
            const x0 = w * 0.06;
            const y0 = h * 0.52;
            const box = s * 0.3;
            label("文本（字形栅格化 + 纹理）", x0, y0);
            // 文字阴影：shadowBlur 走「遮罩 + 分离高斯 + 合成」的图层路径
            if (state.shadow) {
              c2d.shadowColor = "rgba(0, 0, 0, 0.65)";
              c2d.shadowBlur = s * 0.03;
              c2d.shadowOffsetX = s * 0.008;
              c2d.shadowOffsetY = s * 0.008;
            }
            c2d.fillStyle = C.white;
            c2d.font = `700 ${Math.round(box * 0.16)}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
            c2d.fillText("Hello UniDraw 你好 2D", x0, y0 + box * 0.18);
            c2d.shadowColor = "rgba(0, 0, 0, 0)";
            c2d.shadowBlur = 0;
            c2d.shadowOffsetX = 0;
            c2d.shadowOffsetY = 0;

            c2d.fillStyle = C.cyan;
            c2d.font = `500 ${Math.round(box * 0.09)}px system-ui, monospace`;
            const gradT = new LinearGradient(x0, y0 + box * 0.3, x0 + box * 0.8, y0 + box * 0.3);
            gradT.addColorStop(0, C.orange);
            gradT.addColorStop(1, C.red);
            c2d.fillStyle = gradT;
            c2d.font = `600 ${Math.round(box * 0.1)}px system-ui`;
            c2d.fillText("WebGL2 / WebGPU 同一套代码", x0, y0 + box * 0.36);
            c2d.fillStyle = "#2a3550";
            c2d.font = `400 ${Math.round(box * 0.05)}px system-ui`;
            c2d.fillText("矩形 · 圆角 · 圆弧 · 椭圆 · 贝塞尔 · 多边形 · 渐变 · 变换 · 文本", x0, y0 + box * 0.44);
            c2d.fillText("裁剪 · 虚线 · 阴影 · 25 种混合模式（含 overlay / hue / luminosity…）", x0, y0 + box * 0.5);
          }

          // ============ 五、裁剪 + 图层（右下） ============
          {
            const x0 = w * 0.05 + s * 0.38;
            const y0 = h * 0.52;
            const box = s * 0.32;
            label("裁剪（clipRect，save/restore）", x0, y0);
            c2d.save();
            c2d.clipRect(x0 + box * 0.06, y0 + box * 0.06, box * 0.88, box * 0.6);
            const gy = new LinearGradient(x0, y0 + box * 0.06, x0 + box, y0 + box * 0.06);
            gy.addColorStop(0, C.red);
            gy.addColorStop(0.25, C.orange);
            gy.addColorStop(0.5, C.yellow);
            gy.addColorStop(0.75, C.green);
            gy.addColorStop(1, C.blue);
            for (let i = 0; i < 7; i++) {
              const yy = y0 + box * 0.06 + i * box * 0.12;
              c2d.fillStyle = i % 2 ? "#1a2030" : "#28324a";
              c2d.fillRect(x0 - box * 0.5, yy, box * 2.2, box * 0.11);
            }
            c2d.fillStyle = gy;
            c2d.fillRect(x0 - box * 0.5, y0 + box * 0.06, box * 2.2, box * 0.12);
            c2d.restore();

            // restore 后再画一个完整的圆（不被裁剪）
            c2d.fillStyle = C.red;
            c2d.globalAlpha = 0.9;
            c2d.beginPath();
            c2d.arc(x0 + box * 0.5, y0 + box * 0.83, box * 0.07 + Math.sin(t * 2) * box * 0.015, 0, Math.PI * 2);
            fillPath();
            c2d.globalAlpha = 1;
            // 层级：后画的半透明矩形用**图层混合模式**盖在上面
            // （overlay 需要把目标读成纹理，框架会自动切到图层模式）
            c2d.globalCompositeOperation = state.blend ? "overlay" : "source-over";
            c2d.fillStyle = C.cyan;
            c2d.globalAlpha = state.blend ? 0.7 : 0.5;
            c2d.fillRect(x0 + box * 0.34, y0 + box * 0.72, box * 0.3, box * 0.2);
            c2d.globalAlpha = 1;
            c2d.globalCompositeOperation = "source-over";

            // 虚线 + 阴影的圆角矩形。
            // 先垫一块浅色「卡片」再投影：深色背景上黑影几乎看不出来（阴影要落在
            // 比它亮的东西上才看得见），这块卡片就是为了让 shadowBlur 一眼能看见。
            c2d.fillStyle = "#ffffff";
            c2d.beginPath();
            c2d.roundRect(x0 - box * 0.6, y0 + box * 0.96, box * 1.1, box * 0.3, box * 0.05);
            c2d.fill();
            if (state.shadow) {
              c2d.shadowColor = "rgba(0, 0, 0, 0.75)";
              c2d.shadowBlur = s * 0.03;
              c2d.shadowOffsetX = s * 0.012;
              c2d.shadowOffsetY = s * 0.01;
            }
            c2d.fillStyle = C.yellow;
            c2d.beginPath();
            c2d.roundRect(x0 - box * 0.5, y0 + box * 1.02, box * 0.9, box * 0.16, box * 0.04);
            fillPath();
            c2d.shadowColor = "rgba(0, 0, 0, 0)";
            c2d.shadowBlur = 0;
            c2d.shadowOffsetX = 0;
            c2d.shadowOffsetY = 0;
            if (state.dash) c2d.setLineDash([s * 0.02, s * 0.012]);
            c2d.strokeStyle = C.white;
            c2d.lineWidth = Math.max(1.5, s * 0.004);
            c2d.beginPath();
            c2d.moveTo(x0 - box * 0.5, y0 + box * 1.28);
            c2d.lineTo(x0 + box * 0.9, y0 + box * 1.28);
            c2d.stroke();
            c2d.setLineDash([]);
          }

          // 坐标轴/网格背景（轻）
          // 1px 线要落在像素中心 (+0.5)，否则跨像素边界半覆盖 → 真实 GPU 上会发虚/闪
          // （网格线固定 1px，不跟随「线宽倍率」；由面板「显示网格」开关）
          if (state.grid) {
            c2d.strokeStyle = "#ffffff";
            c2d.globalAlpha = 0.05;
            c2d.lineWidth = 1;
            for (let gx = 0; gx < w; gx += s / 8) {
              c2d.beginPath();
              c2d.moveTo(gx + 0.5, 0);
              c2d.lineTo(gx + 0.5, h);
              c2d.stroke();
            }
            for (let gy = 0; gy < h; gy += s / 8) {
              c2d.beginPath();
              c2d.moveTo(0, gy + 0.5);
              c2d.lineTo(w, gy + 0.5);
              c2d.stroke();
            }
            c2d.globalAlpha = 1;
          }

          // 不传投影 = 内置**网页坐标系**（原点左上、y 向下、1 单位 = 1 逻辑像素）
          c2d.flush(pass);
        },
      };
    },
  },
  { depth: false },
);
