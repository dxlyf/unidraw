/**
 * 验证页 · 与**原生 Canvas2D** 的逐像素对照（2D 渲染质量的量化依据）
 *
 * 做法：同一段绘制脚本喂给两种实现 ——
 * - 原生：`CanvasRenderingContext2D`（浏览器的 Skia/Canvas2D 实现，抗锯齿是解析覆盖率）；
 * - 本框架：`Canvas2D` + 与 `Renderer` 默认一致的 4x MSAA 离屏目标。
 * 两边的像素在**预乘空间**逐点比较（预乘才是最终显示值），按区域给出指标，
 * 便于定位「哪一类图元还不够像」。
 *
 * 用法：`npm run build:verify` → `/_verify-2d-parity/index.html?backend=webgl2|webgpu[&msaa=4]`
 * 页面左侧是原生结果、右侧是本框架结果，正下方是每次运行的指标。
 */
import { createDevice } from "../../src/device/createDevice.js";
import { RenderTarget } from "../../src/render/RenderTarget.js";
import { Canvas2D, LinearGradient, RadialGradient } from "../../src/render2d/index.js";

/** 逻辑（网页/CSS）尺寸：场景布局与分区坐标都用它 */
const W = 480;
const H = 270;
const params = new URLSearchParams(location.search);
const SAMPLES = Math.max(1, Math.floor(Number(params.get("msaa") ?? 4)));
/**
 * 逻辑像素 → 物理像素倍率（`?ratio=2`）。给框架侧 `Canvas2D({pixelRatio})`，
 * 原生侧对应 `ctx.scale(ratio, ratio)` —— 两边都用「网页坐标系」画同一份代码。
 */
const RATIO = Math.max(0.25, Number(params.get("ratio") ?? 1));
/** 物理尺寸：目标/画布大小 */
const PW = Math.max(1, Math.round(W * RATIO));
const PH = Math.max(1, Math.round(H * RATIO));

// ---------------------------------------------------------------------------
// 场景：只使用「原生与框架都支持」的 API，两边跑同一份代码
// ---------------------------------------------------------------------------

interface GradientLike {
  addColorStop(offset: number, color: string): unknown;
}

interface SceneCtx {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  miterLimit: number;
  globalAlpha: number;
  font: string;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void;
  quadraticCurveTo(a: number, b: number, c: number, d: number): void;
  arc(x: number, y: number, r: number, s: number, e: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, s: number, e: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  roundRect(x: number, y: number, w: number, h: number, r: number | number[]): void;
  closePath(): void;
  /** 填充规则（`nonzero` / `evenodd`） */
  fill(rule?: string): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  strokeText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { width: number };
  setLineDash?(segments: number[]): void;
  lineDashOffset: number;
  textAlign: string;
  textBaseline: string;
  globalCompositeOperation: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  drawImage(source: unknown, ...args: number[]): void;
  createPattern?(source: unknown, repetition: string): unknown;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(a: number): void;
  scale(x: number, y: number): void;
  /** 框架侧用 clipRect；原生侧由调用点改成 rect()+clip() */
  clipRect?(x: number, y: number, w: number, h: number): void;
  /** 用当前路径做裁剪（原生侧走这个） */
  clip?(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
}

interface GradientFactory {
  linear(x0: number, y0: number, x1: number, y1: number): GradientLike;
  radial(cx: number, cy: number, r: number): GradientLike;
  clip(c: SceneCtx, x: number, y: number, w: number, h: number): void;
}

const FONT = 'system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

/** 每个区域用来定位「哪类图元不够像」 */
const REGIONS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: "曲线粗描边", x: 20, y: 55, w: 230, h: 165 },
  { name: "细线", x: 14, y: 22, w: 150, h: 44 },
  { name: "半透明叠加", x: 52, y: 52, w: 126, h: 126 },
  { name: "线性渐变", x: 16, y: 232, w: 288, h: 34 },
  { name: "径向渐变", x: 364, y: 94, w: 132, h: 132 },
  { name: "圆角矩形", x: 326, y: 206, w: 138, h: 52 },
  { name: "星形(凹多边形)", x: 328, y: 18, w: 96, h: 96 },
  { name: "文字", x: 18, y: 104, w: 240, h: 44 },
  { name: "圆/椭圆", x: 258, y: 148, w: 190, h: 84 },
];

/**
 * 填充规则场景：专门验证「多子路径 / 自相交路径」的填充区域。
 *
 * - 重叠子路径（同一条路径里两个相交矩形）→ 只覆盖一次，半透明不该有深色缝；
 * - 内环挖洞（evenodd / 反向绕序的 nonzero）→ 中间要是空的；
 * - 一笔画五角星（自相交）→ nonzero 中心实心、evenodd 中心是五边形空洞。
 */
const FILL_REGIONS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: "重叠子路径", x: 12, y: 12, w: 148, h: 148 },
  { name: "evenodd 挖洞", x: 170, y: 12, w: 148, h: 148 },
  { name: "nonzero 挖洞", x: 328, y: 12, w: 144, h: 148 },
  { name: "五星 nonzero", x: 12, y: 166, w: 148, h: 96 },
  { name: "五星 evenodd", x: 170, y: 166, w: 148, h: 96 },
  { name: "多轮廓自交", x: 328, y: 166, w: 144, h: 96 },
];

/** 五角星：一笔画的**自相交**路径（5 个顶点按隔点相连） */
function starPath(c: SceneCtx, cx: number, cy: number, r: number): void {
  c.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.closePath();
}

function drawFillRules(c: SceneCtx): void {
  c.fillStyle = "#101826";
  c.fillRect(0, 0, W, H);

  // 1) 一条路径里两个重叠矩形（半透明）：应当只覆盖一次
  c.globalAlpha = 0.55;
  c.fillStyle = "#35d7ee";
  c.beginPath();
  c.rect(24, 24, 88, 88);
  c.rect(64, 64, 88, 88);
  c.fill();
  c.globalAlpha = 1;

  // 2) evenodd 挖洞：外框 + 内框（同向）
  c.fillStyle = "#f5d02e";
  c.beginPath();
  c.rect(186, 24, 116, 116);
  c.rect(214, 52, 60, 60);
  c.fill("evenodd");

  // 3) nonzero 挖洞：内框反向绕序
  c.fillStyle = "#ff9a3d";
  c.beginPath();
  c.rect(344, 24, 112, 112);
  c.moveTo(370, 50);
  c.lineTo(370, 110);
  c.lineTo(430, 110);
  c.lineTo(430, 50);
  c.closePath();
  c.fill();

  // 4) 五星：nonzero（中心实心）
  c.fillStyle = "#ff5c7a";
  starPath(c, 76, 216, 44);
  c.fill();

  // 5) 五星：evenodd（中心留五边形空洞）
  c.fillStyle = "#5aa0ff";
  starPath(c, 234, 216, 44);
  c.fill("evenodd");

  // 6) 多个子路径自相交（两个重叠矩形 + 一个三角），nonzero
  c.fillStyle = "#3dd68c";
  c.beginPath();
  c.rect(352, 176, 72, 72);
  c.rect(384, 200, 64, 60);
  c.moveTo(352, 260);
  c.lineTo(400, 168);
  c.lineTo(444, 260);
  c.closePath();
  c.fill();
}

/** 虚线 + 文字 API（textAlign / textBaseline / strokeText / measureText）场景 */
const EXTRAS_REGIONS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: "虚线", x: 12, y: 14, w: 456, h: 58 },
  { name: "textAlign", x: 12, y: 78, w: 456, h: 52 },
  { name: "textBaseline", x: 12, y: 136, w: 456, h: 56 },
  { name: "strokeText", x: 12, y: 198, w: 456, h: 60 },
];

function drawTextDash(c: SceneCtx): void {
  c.fillStyle = "#101826";
  c.fillRect(0, 0, W, H);

  // 1) 虚线：不同 pattern / 不同 lineDashOffset / 圆头
  c.strokeStyle = "#7aa2ff";
  c.lineWidth = 3;
  c.lineCap = "butt";
  c.setLineDash?.([16, 10]);
  c.lineDashOffset = 0;
  c.beginPath();
  c.moveTo(20, 28);
  c.lineTo(460, 28);
  c.stroke();

  c.strokeStyle = "#3dd68c";
  c.setLineDash?.([16, 10]);
  c.lineDashOffset = 13;
  c.beginPath();
  c.moveTo(20, 44);
  c.lineTo(460, 44);
  c.stroke();

  c.strokeStyle = "#ff9a3d";
  c.lineCap = "round";
  c.setLineDash?.([2, 12]);
  c.lineDashOffset = 0;
  c.beginPath();
  c.moveTo(20, 62);
  c.lineTo(460, 62);
  c.stroke();
  c.setLineDash?.([]);
  c.lineCap = "butt";

  // 2) textAlign：同一 x 上的 left / center / right
  c.fillStyle = "#f2f5ff";
  c.font = `600 20px ${FONT}`;
  const ax = 240;
  c.textAlign = "left";
  c.fillText("left|", ax, 96);
  c.textAlign = "center";
  c.fillText("center", ax, 118);
  c.textAlign = "right";
  c.fillText("|right", ax, 118);
  c.textAlign = "left";

  // 3) textBaseline：同一 y 上的四种基线
  c.font = `500 16px ${FONT}`;
  const by = 172;
  c.fillStyle = "#35d7ee";
  c.textBaseline = "top";
  c.fillText("top", 24, by);
  c.fillStyle = "#f5d02e";
  c.textBaseline = "middle";
  c.fillText("middle", 92, by);
  c.fillStyle = "#ff5c7a";
  c.textBaseline = "bottom";
  c.fillText("bottom", 178, by);
  c.fillStyle = "#b07cff";
  c.textBaseline = "alphabetic";
  c.fillText("alphabetic", 268, by);
  c.textBaseline = "alphabetic";

  // 4) strokeText + fillText（先描边后填充，原生常见用法）
  c.font = `700 30px ${FONT}`;
  c.lineWidth = 4;
  c.strokeStyle = "#5aa0ff";
  c.fillStyle = "#101826";
  c.strokeText("Stroke 描边", 24, 236);
  c.fillText("Stroke 描边", 24, 236);

  // 5) 虚线 + measureText 对齐右端
  const label = "measureText";
  const w = c.measureText(label).width;
  c.font = `400 14px ${FONT}`;
  const w2 = c.measureText(label).width;
  c.fillStyle = "#9aa4bb";
  c.textAlign = "right";
  c.fillText(label, 456, 262);
  c.textAlign = "left";
  // 用测得的宽度画一条等长参考线（宽度不一致会立刻看出错位）
  c.strokeStyle = "#9aa4bb";
  c.lineWidth = 1;
  c.setLineDash?.([]);
  c.beginPath();
  c.moveTo(456 - w2, 264);
  c.lineTo(456, 264);
  c.stroke();
  void w;
}

/** 阴影场景（图层方案：遮罩 + 分离高斯 + 合成） */
const SHADOW_REGIONS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: "模糊阴影", x: 8, y: 8, w: 150, h: 140 },
  { name: "硬阴影", x: 166, y: 8, w: 150, h: 140 },
  { name: "文字阴影", x: 324, y: 8, w: 150, h: 140 },
  { name: "无阴影", x: 8, y: 156, w: 466, h: 106 },
];

function drawShadows(c: SceneCtx): void {
  c.fillStyle = "#101826";
  c.fillRect(0, 0, W, H);
  c.shadowColor = "rgba(0,0,0,0.7)";
  c.shadowBlur = 14;
  c.shadowOffsetX = 7;
  c.shadowOffsetY = 7;
  c.fillStyle = "#35d7ee";
  c.beginPath();
  c.roundRect(30, 30, 96, 96, 14);
  c.fill();
  c.shadowBlur = 0;
  c.shadowOffsetX = 10;
  c.shadowOffsetY = 6;
  c.fillStyle = "#f5d02e";
  c.beginPath();
  c.arc(240, 78, 42, 0, Math.PI * 2);
  c.fill();
  c.shadowColor = "rgba(0,0,0,0.85)";
  c.shadowBlur = 9;
  c.shadowOffsetX = 4;
  c.shadowOffsetY = 4;
  c.fillStyle = "#f2f5ff";
  c.font = "700 32px " + FONT;
  c.fillText("Shadow", 336, 86);
  c.shadowColor = "rgba(0,0,0,0)";
  c.shadowBlur = 0;
  c.shadowOffsetX = 0;
  c.shadowOffsetY = 0;
  c.fillStyle = "#b07cff";
  c.beginPath();
  c.roundRect(40, 180, 120, 62, 10);
  c.fill();
  c.fillStyle = "#3dd68c";
  c.beginPath();
  c.roundRect(200, 180, 120, 62, 10);
  c.fill();
}

/** 单个硬阴影：用来判「阴影画到哪去了」——本体在左上，阴影只可能出现在两个候选位置之一 */
const SHADOW1_REGIONS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: "本体", x: 10, y: 10, w: 90, h: 60 },
  { name: "阴影(正向)", x: 210, y: 50, w: 90, h: 60 },
  { name: "阴影(上下翻)", x: 210, y: 160, w: 90, h: 60 },
  { name: "空白区", x: 330, y: 100, w: 140, h: 100 },
];

function drawShadow1(c: SceneCtx): void {
  c.fillStyle = "#101826";
  c.fillRect(0, 0, W, H);
  // 本体 (20,20)-(80,60)；阴影 = 本体 + (200,40) = (220,60)-(280,100)
  // 若采样被上下翻转，就会出现在 y = 270-100 .. 270-60 = 170..210（即「阴影(上下翻)」那格）
  c.shadowColor = "rgba(255,64,64,1)";
  c.shadowBlur = 0;
  c.shadowOffsetX = 200;
  c.shadowOffsetY = 40;
  c.fillStyle = "#00a0ff";
  c.fillRect(20, 20, 60, 40);
}

/** 阴影 + 图层混合模式**同帧**：两者都会改 pass 结构（阴影多趟 submit、混合 ping-pong），
 *  最容易互相踩 —— WebGL2 上曾经整幅几乎空白（只剩网格和一个形状） */
const SHADOWBLEND_REGIONS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: "阴影区", x: 8, y: 8, w: 150, h: 120 },
  { name: "混合区", x: 158, y: 8, w: 156, h: 120 },
  { name: "混合之后", x: 320, y: 8, w: 152, h: 120 },
  { name: "底部一排", x: 8, y: 140, w: 464, h: 122 },
];

function drawShadowBlend(c: SceneCtx): void {
  // `?sb=` 用于二分定位（noA=去掉第一组阴影 / noB=去掉第二组 / noclip=去掉裁剪）
  const sb = params.get("sb") ?? "full";
  const withA = sb !== "noA" && sb !== "onlyB";
  const withB = sb !== "noB" && sb !== "onlyA";
  const withClip = sb !== "noclip";

  c.fillStyle = "#101826";
  c.fillRect(0, 0, W, H);

  // 1) 第一组阴影（文字）：出现在图层混合**之前**
  if (withA) {
    c.shadowColor = "rgba(0,0,0,0.65)";
    c.shadowBlur = 10;
    c.shadowOffsetX = 4;
    c.shadowOffsetY = 4;
    c.fillStyle = "#f2f5ff";
    c.font = `700 24px ${FONT}`;
    c.fillText("shadow-A", 24, 60);
    c.shadowColor = "rgba(0,0,0,0)";
    c.shadowBlur = 0;
    c.shadowOffsetX = 0;
    c.shadowOffsetY = 0;
  }

  // 2) 图层混合模式（overlay）：目标是上面已经画好的内容
  c.fillStyle = "#ff9a3d";
  c.fillRect(170, 30, 60, 70);
  c.globalCompositeOperation = "overlay";
  c.fillStyle = "#8f5cff";
  c.beginPath();
  c.arc(230, 65, 28, 0, Math.PI * 2);
  c.fill();
  c.globalCompositeOperation = "source-over";

  // 3) 第二组阴影（圆角矩形）：参数不同 → 另一组，且出现在混合**之后**（+ 裁剪里）
  if (withClip) {
    c.save();
    if (c.clipRect) c.clipRect(320, 20, 152, 100);
    else {
      c.beginPath();
      c.rect(320, 20, 152, 100);
      c.clip!();
    }
  }
  if (withB) {
    c.shadowColor = "rgba(0,0,0,0.7)";
    c.shadowBlur = 8;
    c.shadowOffsetX = 6;
    c.shadowOffsetY = 5;
  }
  c.fillStyle = "#f5d02e";
  c.beginPath();
  c.roundRect(330, 30, 90, 50, 8);
  c.fill();
  c.shadowColor = "rgba(0,0,0,0)";
  c.shadowBlur = 0;
  c.shadowOffsetX = 0;
  c.shadowOffsetY = 0;
  if (withClip) c.restore();

  // 4) 混合之后还要有普通图形 + 文字（验证 ping-pong 之后图层没丢）
  c.fillStyle = "#3dd68c";
  c.beginPath();
  c.roundRect(340, 86, 100, 24, 6);
  c.fill();
  c.fillStyle = "#f2f5ff";
  c.font = `700 18px ${FONT}`;
  c.fillText("after", 352, 104);

  // 5) 底部一排普通图形
  for (let i = 0; i < 6; i++) {
    c.fillStyle = i % 2 ? "#f5d02e" : "#ff5c7a";
    c.beginPath();
    c.roundRect(20 + i * 76, 170, 60, 60, 8);
    c.fill();
  }
}

/** clearRect 场景：清成透明黑，且不受 fillStyle/globalAlpha/阴影影响、受变换与裁剪影响 */
const CLEAR_REGIONS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: "清出空洞", x: 8, y: 8, w: 150, h: 116 },
  { name: "清后重画", x: 166, y: 8, w: 150, h: 116 },
  { name: "裁剪内清除", x: 324, y: 8, w: 150, h: 116 },
  { name: "变换+忽略样式", x: 8, y: 132, w: 466, h: 130 },
];

function drawClearRect(c: SceneCtx): void {
  // 底：整块不透明底图（清出来的洞在对照页上就是透明，两侧应完全一致）
  c.fillStyle = "#101826";
  c.fillRect(0, 0, W, H);

  // 1) 实心块中间清一个洞
  c.fillStyle = "#35d7ee";
  c.fillRect(30, 30, 110, 72);
  c.clearRect(60, 45, 50, 40);

  // 2) 清掉之后重新画（验证 op 顺序）
  c.fillStyle = "#ff9a3d";
  c.fillRect(190, 30, 110, 72);
  c.clearRect(215, 45, 60, 40);
  c.fillStyle = "#3dd68c";
  c.fillRect(235, 55, 40, 22);

  // 3) 裁剪内清除：只有裁剪区内的部分被清掉
  c.save();
  if (c.clipRect) c.clipRect(348, 30, 50, 72);
  else {
    c.beginPath();
    c.rect(348, 30, 50, 72);
    c.clip!();
  }
  c.fillStyle = "#b07cff";
  c.fillRect(340, 24, 120, 84);
  c.clearRect(360, 40, 90, 50);
  c.restore();

  // 4) 变换 + 忽略 globalAlpha / fillStyle / 阴影：
  //    即使 globalAlpha=0.3、fillStyle 是渐变、还开着阴影，也必须清得干干净净
  c.save();
  c.translate(120, 190);
  c.rotate(0.25);
  c.globalAlpha = 0.3;
  c.fillStyle = "#f5d02e";
  c.fillRect(-70, -40, 140, 80);
  c.globalAlpha = 0.3;
  c.shadowColor = "rgba(255,0,0,0.9)";
  c.shadowBlur = 14;
  c.shadowOffsetX = 6;
  c.shadowOffsetY = 6;
  c.clearRect(-30, -18, 60, 36);
  c.shadowColor = "rgba(0,0,0,0)";
  c.shadowBlur = 0;
  c.shadowOffsetX = 0;
  c.shadowOffsetY = 0;
  c.globalAlpha = 1;
  c.restore();

  // 5) 宽度为 0：什么都不做（也不该报错）
  c.fillStyle = "#ff5c7a";
  c.fillRect(300, 160, 120, 60);
  c.clearRect(320, 170, 0, 40);
  c.clearRect(360, 170, 40, 0);
}

/** 颜色解析 + 描边阴影：命名色/hsl/8 位 hex 填充色、命名色阴影、stroke() 的阴影 */
const COLOR2_REGIONS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: "命名色填充", x: 8, y: 8, w: 150, h: 120 },
  { name: "hsl+8位hex", x: 158, y: 8, w: 150, h: 120 },
  { name: "命名色阴影", x: 308, y: 8, w: 164, h: 120 },
  { name: "描边阴影", x: 8, y: 132, w: 464, h: 130 },
];

function drawColorShadows(c: SceneCtx): void {
  c.fillStyle = "#101826";
  c.fillRect(0, 0, W, H);

  // 1) 命名色填充
  c.fillStyle = "black";
  c.fillRect(30, 30, 100, 60);
  c.fillStyle = "red";
  c.beginPath();
  c.arc(80, 100, 20, 0, Math.PI * 2);
  c.fill();

  // 2) hsl + 8 位 hex（带 alpha）
  c.fillStyle = "hsl(200, 80%, 60%)";
  c.fillRect(180, 30, 100, 60);
  c.fillStyle = "#ff880080";
  c.fillRect(200, 70, 100, 50);

  // 3) **命名色阴影**（原来只认 #hex 与 rgb()，`"black"` 会解析失败 → 完全不画阴影）
  c.shadowColor = "black";
  c.shadowBlur = 10;
  c.shadowOffsetX = 6;
  c.shadowOffsetY = 6;
  c.fillStyle = "#35d7ee";
  c.beginPath();
  c.roundRect(330, 34, 110, 70, 10);
  c.fill();
  c.shadowColor = "rgba(0,0,0,0)";
  c.shadowBlur = 0;
  c.shadowOffsetX = 0;
  c.shadowOffsetY = 0;

  // 4) **描边阴影**（原生 stroke() 也投影；框架原来只给 fill 做阴影）
  c.shadowColor = "rgba(0, 0, 0, 0.7)";
  c.shadowBlur = 12;
  c.shadowOffsetX = 8;
  c.shadowOffsetY = 8;
  c.strokeStyle = "#f5d02e";
  c.lineWidth = 10;
  c.lineJoin = "round";
  c.beginPath();
  c.roundRect(40, 160, 180, 80, 16);
  c.stroke();
  c.strokeStyle = "#ff5c7a";
  c.lineWidth = 8;
  c.beginPath();
  c.arc(360, 200, 46, 0, Math.PI * 2);
  c.stroke();
  c.shadowColor = "rgba(0,0,0,0)";
  c.shadowBlur = 0;
  c.shadowOffsetX = 0;
  c.shadowOffsetY = 0;
}

/** 描边场景：闭合路径首尾的 join（原生 vs 本框架） */
const STROKE_REGIONS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: "rect+miter", x: 8, y: 8, w: 116, h: 116 },
  { name: "closePath三角", x: 128, y: 8, w: 116, h: 116 },
  { name: "首尾重合点", x: 248, y: 8, w: 116, h: 116 },
  { name: "整圆arc", x: 368, y: 8, w: 106, h: 116 },
  { name: "闭合贝塞尔心形", x: 8, y: 132, w: 226, h: 128 },
  { name: "五角星miter", x: 244, y: 132, w: 230, h: 128 },
  { name: "round左上(收尾)", x: 24, y: 24, w: 32, h: 32 },
  { name: "round右上", x: 76, y: 24, w: 32, h: 32 },

];

function drawStrokes(c: SceneCtx): void {
  c.fillStyle = "#101826";
  c.fillRect(0, 0, W, H);
  c.strokeStyle = "#35d7ee";
  c.lineWidth = 14;
  c.lineJoin = "miter";
  c.miterLimit = 10;
  c.lineCap = "butt";

  // 1) rect（内部会 closePath）
  c.beginPath();
  c.rect(26, 26, 80, 80);
  c.stroke();

  // 2) moveTo/lineTo×2 + closePath
  c.beginPath();
  c.moveTo(186, 26);
  c.lineTo(146, 106);
  c.lineTo(226, 106);
  c.closePath();
  c.stroke();

  // 3) 首尾重合点（**没有** closePath：末点显式回到起点）
  c.beginPath();
  c.moveTo(306, 26);
  c.lineTo(266, 106);
  c.lineTo(346, 106);
  c.lineTo(306, 26);
  c.stroke();

  // 4) 整圆 arc（首尾点重合）
  c.beginPath();
  c.arc(421, 66, 40, 0, Math.PI * 2);
  c.stroke();

  // 5) closePath + round join
  c.strokeStyle = "#ff9a3d";
  c.lineJoin = "round";
  c.lineWidth = 12;
  c.beginPath();
  c.moveTo(128, 206);
  c.bezierCurveTo(128 - 52, 206 - 34, 128 - 29, 206 - 72, 128, 206 - 29);
  c.bezierCurveTo(128 + 29, 206 - 72, 128 + 52, 206 - 34, 128, 206);
  c.closePath();
  c.stroke();

  // 6b) 心形写法：贝塞尔回到起点 + closePath（收尾点与起点重合）
  c.strokeStyle = "#ff5c7a";
  c.lineJoin = "round";
  c.lineWidth = 9;
  c.beginPath();
  const hx = 110;
  const hy = 200;
  const sc = 42;
  c.moveTo(hx, hy + sc * 0.2);
  c.bezierCurveTo(hx - sc * 0.9, hy - sc * 0.5, hx - sc * 0.5, hy - sc * 1.05, hx, hy - sc * 0.42);
  c.bezierCurveTo(hx + sc * 0.5, hy - sc * 1.05, hx + sc * 0.9, hy - sc * 0.5, hx, hy + sc * 0.2);
  c.closePath();
  c.stroke();

  // 7) 用户报的那一档：rect + round join；一粗一细对照
  c.strokeStyle = "#f2f5ff";
  c.lineJoin = "round";
  c.lineWidth = 12;
  c.beginPath();
  c.rect(40, 40, 52, 52);
  c.stroke();
  c.lineWidth = 1.6;
  c.beginPath();
  c.rect(160, 40, 52, 52);
  c.stroke();

  // 6) 五角星 miter（尖角 + 首尾闭合）
  c.strokeStyle = "#f5d02e";
  c.lineJoin = "miter";
  c.lineWidth = 10;
  c.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    const x = 359 + Math.cos(a) * 52;
    const y = 196 + Math.sin(a) * 52;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.closePath();
  c.stroke();
}

/** 图案填充场景：repeat / repeat-x / repeat-y / no-repeat + 图案描边 + 图案文字 */
const PATTERN_REGIONS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: "repeat", x: 12, y: 12, w: 148, h: 148 },
  { name: "repeat-x", x: 170, y: 12, w: 148, h: 148 },
  { name: "repeat-y", x: 328, y: 12, w: 144, h: 148 },
  { name: "no-repeat", x: 12, y: 174, w: 148, h: 84 },
  { name: "图案描边", x: 170, y: 174, w: 148, h: 84 },
  { name: "图案文字", x: 328, y: 174, w: 144, h: 84 },
];

function drawPatterns(c: SceneCtx): void {
  const img = makeSourceImage();
  c.fillStyle = "#101826";
  c.fillRect(0, 0, W, H);

  const cases: [string, number, number, number, number][] = [
    ["repeat", 24, 24, 124, 124],
    ["repeat-x", 182, 24, 124, 124],
    ["repeat-y", 340, 24, 120, 124],
    ["no-repeat", 24, 186, 124, 60],
  ];
  for (const [rep, x, y, w, h] of cases) {
    const p = c.createPattern?.(img, rep);
    if (!p) continue;
    c.fillStyle = p;
    c.beginPath();
    c.roundRect(x, y, w, h, 14);
    c.fill();
    c.fillStyle = "#8b93a7";
    c.font = `600 10px ${FONT}`;
    c.fillText(rep, x, y + h + 12);
  }

  const ps = c.createPattern?.(img, "repeat");
  if (ps) {
    c.strokeStyle = ps;
    c.lineWidth = 12;
    c.beginPath();
    c.roundRect(182, 186, 124, 60, 20);
    c.stroke();
  }

  const pt = c.createPattern?.(img, "repeat");
  if (pt) {
    c.fillStyle = pt;
    c.font = `700 26px ${FONT}`;
    c.fillText("Pattern", 340, 220);
  }
}

/** drawImage 场景：源图由离屏 2D 画布程序化生成（不依赖外部资源） */
const IMAGE_REGIONS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: "1:1 原图", x: 12, y: 12, w: 150, h: 120 },
  { name: "缩放", x: 170, y: 12, w: 150, h: 120 },
  { name: "裁剪缩放", x: 328, y: 12, w: 144, h: 120 },
  { name: "旋转透明度", x: 12, y: 146, w: 306, h: 114 },
  { name: "缩小平铺", x: 328, y: 146, w: 144, h: 114 },
];

function makeSourceImage(): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = 96;
  cv.height = 64;
  const g = cv.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 96, 0);
  grad.addColorStop(0, "#ff5c7a");
  grad.addColorStop(0.5, "#f5d02e");
  grad.addColorStop(1, "#35d7ee");
  g.fillStyle = grad;
  g.fillRect(0, 0, 96, 64);
  g.fillStyle = "#101826";
  g.beginPath();
  g.arc(30, 32, 16, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  g.fillRect(56, 12, 28, 40);
  g.fillStyle = "#3dd68c";
  g.beginPath();
  g.moveTo(0, 64);
  g.lineTo(20, 40);
  g.lineTo(40, 64);
  g.closePath();
  g.fill();
  return cv;
}

function drawImages(c: SceneCtx): void {
  const img = makeSourceImage();
  c.fillStyle = "#101826";
  c.fillRect(0, 0, W, H);

  c.drawImage(img, 20, 20); // 1:1
  c.drawImage(img, 186, 20, 110, 90); // 缩放
  c.drawImage(img, 0, 0, 48, 32, 344, 24, 112, 74); // 裁剪 + 缩放

  // 旋转 + 透明度
  c.save();
  c.globalAlpha = 0.65;
  c.translate(160, 200);
  c.rotate(0.35);
  c.drawImage(img, -48, -32, 96, 64);
  c.restore();

  // 缩小平铺（同一张图反复绘制）
  c.save();
  for (let ty = 0; ty < 3; ty++) {
    for (let tx = 0; tx < 8; tx++) c.drawImage(img, 336 + tx * 8, 152 + ty * 8, 8, 8);
  }
  c.restore();
}

/** 合成模式场景：每个模式一块「底图 + 叠加形状」，与原生逐块对照 */
const COMPOSITE_MODES = [
  "destination-over",
  "source-in",
  "destination-in",
  "source-out",
  "destination-out",
  "source-atop",
  "destination-atop",
  "xor",
  "lighter",
  "copy",
  "multiply",
  "screen",
  "darken",
  "lighten",
] as const;

const COMPOSITE_REGIONS: { name: string; x: number; y: number; w: number; h: number }[] = [];
const CELL_W = 78;
const CELL_H = 66;
COMPOSITE_MODES.forEach((mode, i) => {
  const col = i % 6;
  const row = Math.floor(i / 6);
  COMPOSITE_REGIONS.push({ name: mode, x: col * CELL_W + 4, y: row * CELL_H + 4, w: CELL_W - 8, h: CELL_H - 8 });
});

/** 每个单元格：先画底图（不透明渐变块 + 透明区），再用指定模式叠加一个圆 */
function drawComposite(c: SceneCtx): void {
  c.fillStyle = "#0b0c10";
  c.fillRect(0, 0, W, H);
  c.font = `600 10px ${FONT}`;

  COMPOSITE_MODES.forEach((mode, i) => {
    const col = i % 6;
    const row = Math.floor(i / 6);
    const x = col * CELL_W + 6;
    const y = row * CELL_H + 6;
    const w = CELL_W - 12;
    const h = CELL_H - 18;

    // 底图：左半不透明青、右半不透明橙，整体是实心矩形
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    c.fillStyle = "#35d7ee";
    c.fillRect(x, y, w * 0.55, h);
    c.fillStyle = "#ff9a3d";
    c.fillRect(x + w * 0.45, y, w * 0.55, h);

    // 叠加一个半透明圆，使用当前合成模式
    c.globalCompositeOperation = mode;
    c.fillStyle = "#f5d02e";
    c.globalAlpha = 0.75;
    c.beginPath();
    c.arc(x + w * 0.5, y + h * 0.5, Math.min(w, h) * 0.42, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";

    c.fillStyle = "#8b93a7";
    c.fillText(mode, x, y + h + 12);
  });
}

/** 图层模式场景：11 种「以目标为纹理」的混合模式，每格底图不同以便区分公式 */
const BLEND_MODES = [
  "overlay",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;

const BLEND_REGIONS: { name: string; x: number; y: number; w: number; h: number }[] = [];
const BLEND_CELL_W = 120;
const BLEND_CELL_H = 90;
BLEND_MODES.forEach((mode, i) => {
  const col = i % 4;
  const row = Math.floor(i / 4);
  BLEND_REGIONS.push({ name: mode, x: col * BLEND_CELL_W + 4, y: row * BLEND_CELL_H + 2, w: BLEND_CELL_W - 8, h: BLEND_CELL_H - 16 });
});

function drawBlendModes(c: SceneCtx): void {
  c.fillStyle = "#0b0c10";
  c.fillRect(0, 0, W, H);
  c.font = `600 10px ${FONT}`;

  BLEND_MODES.forEach((mode, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = col * BLEND_CELL_W + 6;
    const y = row * BLEND_CELL_H + 4;
    const w = BLEND_CELL_W - 12;
    const h = BLEND_CELL_H - 20;

    // 底图：三段不同明度的色块 + 一段渐变，覆盖公式的各个分支
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    c.fillStyle = "#20304a";
    c.fillRect(x, y, w, h);
    c.fillStyle = "#6fd0ff";
    c.fillRect(x, y, w * 0.3, h);
    c.fillStyle = "#ffbe4d";
    c.fillRect(x + w * 0.3, y, w * 0.35, h);
    c.fillStyle = "#c9d4e6";
    c.fillRect(x + w * 0.65, y, w * 0.35, h);

    // 源：一个覆盖大半格的斜向渐变矩形（用纯色 + 半透明圆两层，考察 αs 混合）
    c.globalCompositeOperation = mode;
    c.globalAlpha = 0.85;
    c.fillStyle = "#8f5cff";
    c.beginPath();
    c.roundRect(x + w * 0.12, y + h * 0.15, w * 0.6, h * 0.7, 8);
    c.fill();
    c.fillStyle = "#2ee6a8";
    c.beginPath();
    c.arc(x + w * 0.62, y + h * 0.55, Math.min(w, h) * 0.28, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";

    c.fillStyle = "#8b93a7";
    c.fillText(mode, x, y + h + 11);
  });
}

function drawScene(c: SceneCtx, g: GradientFactory): void {
  // 背景：竖向线性渐变（整幅不透明，两侧都从透明画到不透明）
  const bg = g.linear(0, 0, 0, H);
  bg.addColorStop(0, "#101826");
  bg.addColorStop(1, "#1d2740");
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);

  // 1) 粗贝塞尔描边（曲线平滑度 / 宽描边）
  c.strokeStyle = "#ff5c7a";
  c.lineWidth = 9;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.beginPath();
  c.moveTo(34, 196);
  c.bezierCurveTo(84, 62, 176, 236, 238, 116);
  c.stroke();

  // 2) 1.2px 细线（细描边保真度：最容易看出锯齿）
  c.strokeStyle = "#f2f5ff";
  c.lineWidth = 1.2;
  c.lineCap = "butt";
  c.beginPath();
  c.moveTo(20, 32);
  c.lineTo(158, 58);
  c.stroke();

  // 3) 半透明叠加（同一路径/相邻图元的重叠处不应出现二次混合的深色缝）
  c.globalAlpha = 0.5;
  c.fillStyle = "#ffd54a";
  c.fillRect(60, 60, 72, 72);
  c.fillStyle = "#4ce08a";
  c.fillRect(104, 102, 72, 72);
  c.globalAlpha = 1;

  // 4) 多段线性渐变（逐像素求值 vs 顶点采样的差异在 stop 边界处最明显）
  const lg = g.linear(20, 240, 300, 240);
  lg.addColorStop(0, "#ff0000");
  lg.addColorStop(0.25, "#ffd000");
  lg.addColorStop(0.5, "#3dd68c");
  lg.addColorStop(0.75, "#35a0ff");
  lg.addColorStop(1, "#b07cff");
  c.fillStyle = lg;
  c.fillRect(20, 236, 280, 26);

  // 5) 径向渐变（框架侧是按顶点采样 + 细分近似的，最容易看出差别）
  const rg = g.radial(430, 160, 58);
  rg.addColorStop(0, "#ffffff");
  rg.addColorStop(0.55, "#ff9a3d");
  rg.addColorStop(1, "#5a1f00");
  c.fillStyle = rg;
  c.beginPath();
  c.arc(430, 160, 58, 0, Math.PI * 2);
  c.fill();

  // 6) 圆角矩形（四角不同半径）
  c.fillStyle = "#5aa0ff";
  c.beginPath();
  c.roundRect(330, 210, 130, 44, [22, 6, 22, 6]);
  c.fill();

  // 7) 星形（凹多边形填充，耳切）
  c.fillStyle = "#f5d02e";
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 40 : 18;
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const x = 376 + Math.cos(a) * r;
    const y = 66 + Math.sin(a) * r;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.closePath();
  c.fill();

  // 8) 文字（两号字：字形栅格化 + 定位）
  c.fillStyle = "#f2f5ff";
  c.font = `600 22px ${FONT}`;
  c.fillText("UniDraw 你好 2D", 22, 128);
  c.fillStyle = "#9aa4bb";
  c.font = `400 12px ${FONT}`;
  c.fillText("Canvas2D parity · 0.5px hairline", 22, 146);

  // 9) 圆 + 旋转椭圆
  c.fillStyle = "#35d7ee";
  c.beginPath();
  c.arc(300, 190, 32, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 0.85;
  c.fillStyle = "#b07cff";
  c.beginPath();
  c.ellipse(392, 176, 44, 22, 0.45, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 1;

  // 10) 半透明粗折线（round join/cap 处不应出现接缝与二次混合）
  c.globalAlpha = 0.6;
  c.strokeStyle = "#ffffff";
  c.lineWidth = 13;
  c.lineJoin = "round";
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(252, 34);
  c.lineTo(300, 62);
  c.lineTo(346, 28);
  c.stroke();
  c.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// 两侧的适配
// ---------------------------------------------------------------------------

function nativeFactory(ctx: CanvasRenderingContext2D): GradientFactory {
  return {
    linear: (x0, y0, x1, y1) => ctx.createLinearGradient(x0, y0, x1, y1),
    radial: (cx, cy, r) => ctx.createRadialGradient(cx, cy, 0, cx, cy, r),
    clip: (c, x, y, w, h) => {
      c.beginPath();
      c.rect(x, y, w, h);
      ctx.clip();
    },
  };
}

function oursFactory(): GradientFactory {
  return {
    linear: (x0, y0, x1, y1) => new LinearGradient(x0, y0, x1, y1),
    radial: (cx, cy, r) => new RadialGradient(cx, cy, r),
    clip: (c, x, y, w, h) => c.clipRect?.(x, y, w, h),
  };
}

// ---------------------------------------------------------------------------
// 指标
// ---------------------------------------------------------------------------

interface Region {
  name: string;
  mean: number;
  over16: number;
  over48: number;
}

/** 场景：`?scene=parity`（默认，全能力） / `?scene=fillrules`（多子路径填充规则） */
const SCENES: Record<string, { label: string; draw: (c: SceneCtx, g: GradientFactory) => void; regions: typeof REGIONS }> = {
  parity: { label: "全能力", draw: drawScene, regions: REGIONS },
  fillrules: { label: "填充规则", draw: (c) => drawFillRules(c), regions: FILL_REGIONS },
  extras: { label: "虚线/文字API", draw: (c) => drawTextDash(c), regions: EXTRAS_REGIONS },
  composite: { label: "合成模式", draw: (c) => drawComposite(c), regions: COMPOSITE_REGIONS },
  blend: { label: "图层混合模式", draw: (c) => drawBlendModes(c), regions: BLEND_REGIONS },
  shadowblend: { label: "阴影+图层混合", draw: (c) => drawShadowBlend(c), regions: SHADOWBLEND_REGIONS },
  clear: { label: "clearRect", draw: (c) => drawClearRect(c), regions: CLEAR_REGIONS },
  colorshadow: { label: "颜色解析+描边阴影", draw: (c) => drawColorShadows(c), regions: COLOR2_REGIONS },
  image: { label: "drawImage", draw: (c) => drawImages(c), regions: IMAGE_REGIONS },
  pattern: { label: "图案填充", draw: (c) => drawPatterns(c), regions: PATTERN_REGIONS },
  stroke: { label: "闭合描边", draw: (c) => drawStrokes(c), regions: STROKE_REGIONS },
  shadow: { label: "阴影", draw: (c) => drawShadows(c), regions: SHADOW_REGIONS },
  shadow1: { label: "单阴影定位", draw: (c) => drawShadow1(c), regions: SHADOW1_REGIONS },
};
const sceneId = params.get("scene") ?? "parity";
const scene = SCENES[sceneId] ?? SCENES.parity!;
const activeRegions = scene.regions;

function compare(a: Uint8ClampedArray | Uint8Array, b: Uint8ClampedArray | Uint8Array): { overall: Region; regions: Region[] } {
  // 分区坐标是**逻辑（网页）坐标**，按 RATIO 放大到物理像素再取样
  const region = (lx0: number, ly0: number, lw: number, lh: number): { mean: number; over16: number; over48: number } => {
    const x0 = Math.floor(lx0 * RATIO);
    const y0 = Math.floor(ly0 * RATIO);
    const x1 = Math.min(PW, Math.ceil((lx0 + lw) * RATIO));
    const y1 = Math.min(PH, Math.ceil((ly0 + lh) * RATIO));
    let sum = 0;
    let n = 0;
    let o16 = 0;
    let o48 = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * PW + x) * 4;
        const d = (Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!)) / 3;
        sum += d;
        n++;
        if (d > 16) o16++;
        if (d > 48) o48++;
      }
    }
    return { mean: sum / Math.max(1, n), over16: o16 / Math.max(1, n), over48: o48 / Math.max(1, n) };
  };

  const all = region(0, 0, W, H);
  return {
    overall: { name: "整幅", ...all },
    regions: activeRegions.map((r) => ({ name: r.name, ...region(r.x, r.y, r.w, r.h) })),
  };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const errEl = document.createElement("div");
errEl.id = "err";
errEl.className = "err";
document.body.appendChild(errEl);

function layout(): { nativeSlot: HTMLElement; oursSlot: HTMLElement; stats: HTMLElement } {
  document.body.style.cssText = "margin:0;background:#0b0c10;color:#d7d9e0;font:12px ui-monospace,Consolas,monospace";
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:10px;padding:10px";
  const mk = (title: string) => {
    const box = document.createElement("div");
    const h = document.createElement("div");
    h.textContent = title;
    h.style.cssText = "padding:4px 0;color:#8b93a7";
    const slot = document.createElement("div");
    box.appendChild(h);
    box.appendChild(slot);
    row.appendChild(box);
    return slot;
  };
  const nativeSlot = mk("原生 Canvas2D");
  const oursSlot = mk("UniDraw Canvas2D");
  const stats = document.createElement("pre");
  stats.style.cssText = "margin:0;padding:0 12px 16px;color:#9aa4bb;white-space:pre-wrap";
  document.body.appendChild(row);
  document.body.appendChild(stats);
  return { nativeSlot, oursSlot, stats };
}

async function main(): Promise<void> {
  const { nativeSlot, oursSlot, stats } = layout();

  // ---- 原生 ----
  const nativeCanvas = document.createElement("canvas");
  nativeCanvas.width = PW;
  nativeCanvas.height = PH;
  nativeCanvas.style.cssText = `display:block;width:${W}px;height:${H}px`;
  const nctx = nativeCanvas.getContext("2d", { willReadFrequently: true })!;
  nctx.clearRect(0, 0, PW, PH);
  // 原生侧同样按「网页坐标系」画：逻辑像素 × RATIO（等价于 CSS 尺寸 + DPR）
  nctx.scale(RATIO, RATIO);
  scene.draw(nctx as unknown as SceneCtx, nativeFactory(nctx));
  const nativeData = nctx.getImageData(0, 0, PW, PH).data;
  nativeSlot.appendChild(nativeCanvas);

  // ---- 框架 ----
  const uniCanvas = document.createElement("canvas");
  uniCanvas.width = 8;
  uniCanvas.height = 8;
  const device = await createDevice({ canvas: uniCanvas, backend: (params.get("backend") ?? "auto") as "auto" | "webgpu" | "webgl2" | "mock" });
  const target = new RenderTarget(device, {
    label: "parity-2d",
    width: PW,
    height: PH,
    depth: false,
    sampleCount: SAMPLES,
    format: device.canvasFormat() ?? "rgba8unorm",
  });
  // 框架侧用「网页坐标系」：pixelRatio = RATIO，flush 不传投影（用内置的网页坐标投影）
  const c2d = new Canvas2D(device, { pixelRatio: RATIO });
  // 调试用：把实例暴露出来（无头排查时可以直接读图层纹理内容）
  (globalThis as Record<string, unknown>).__c2d = c2d;
  const encoder = device.createCommandEncoder("parity");
  const pass = encoder.beginRenderPass({
    label: "parity-2d",
    colorAttachments: [target.colorAttachment({ clearValue: { r: 0, g: 0, b: 0, a: 0 } })],
    depthStencilAttachment: null,
  });
  c2d.setViewportSize(PW, PH);
  c2d.begin();
  scene.draw(c2d as unknown as SceneCtx, oursFactory());
  c2d.flush(pass);
  pass.end();
  device.submit([encoder.finish()]);

  const ours = await target.readPixels();
  const ourCanvas = document.createElement("canvas");
  ourCanvas.width = PW;
  ourCanvas.height = PH;
  ourCanvas.style.cssText = `display:block;width:${W}px;height:${H}px`;
  ourCanvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(ours), PW, PH), 0, 0);
  oursSlot.appendChild(ourCanvas);

  // 半透明区域若两侧 alpha 语义不同，先确认一下
  let alphaMismatch = 0;
  for (let i = 3; i < ours.length; i += 4) if (Math.abs(ours[i]! - nativeData[i]!) > 8) alphaMismatch++;

  const { overall, regions } = compare(nativeData, ours);

  // 最优整数偏移：若「错开几像素后差异骤降」说明是整体位移（而不是图元质量问题）
  let best = { dx: 0, dy: 0, mean: Infinity };
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      let sum = 0;
      let n = 0;
      for (let y = 4; y < PH - 4; y++) {
        for (let x = 4; x < PW - 4; x++) {
          const i = (y * PW + x) * 4;
          const j = ((y + dy) * PW + (x + dx)) * 4;
          sum += (Math.abs(nativeData[i]! - ours[j]!) + Math.abs(nativeData[i + 1]! - ours[j + 1]!) + Math.abs(nativeData[i + 2]! - ours[j + 2]!)) / 3;
          n++;
        }
      }
      const m = sum / n;
      if (m < best.mean) best = { dx, dy, mean: m };
    }
  }

  // 差异热力图（每格平均通道差）—— 定位差异集中在哪些图元上
  const COLS = 80;
  const ROWS = 27;
  const ramp = " .:-=+*#%@";
  const mapLines: string[] = [];
  for (let cy = 0; cy < ROWS; cy++) {
    let line = "";
    for (let cx = 0; cx < COLS; cx++) {
      const x0 = Math.floor((cx * PW) / COLS);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * PW) / COLS));
      const y0 = Math.floor((cy * PH) / ROWS);
      const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * PH) / ROWS));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * PW + x) * 4;
          sum += (Math.abs(nativeData[i]! - ours[i]!) + Math.abs(nativeData[i + 1]! - ours[i + 1]!) + Math.abs(nativeData[i + 2]! - ours[i + 2]!)) / 3;
          n++;
        }
      }
      line += ramp[Math.min(9, Math.floor(((sum / n) / 96) * 10))];
    }
    mapLines.push(`PARITY_MAP ${String(cy).padStart(2, "0")} |${line}|`);
  }

  const lines = [
    `${device.kind} · msaa=${target.sampleCount} · 物理 ${PW}x${PH}（网页坐标 ${W}x${H} · ratio=${RATIO}）`,
    `整幅      mean=${overall.mean.toFixed(2)}  >16:${(overall.over16 * 100).toFixed(2)}%  >48:${(overall.over48 * 100).toFixed(2)}%`,
    ...regions.map((r) => `${r.name.padEnd(8, " ")}  mean=${r.mean.toFixed(2).padStart(6)}  >16:${(r.over16 * 100).toFixed(2).padStart(5)}%  >48:${(r.over48 * 100).toFixed(2).padStart(5)}%`),
    `最优偏移  dx=${best.dx} dy=${best.dy} mean=${best.mean.toFixed(2)}（0,0 时 ${overall.mean.toFixed(2)}）`,
    `alpha 差异像素=${alphaMismatch}`,
  ];
  stats.textContent = lines.join("\n");
  (globalThis as Record<string, unknown>).__parityMap = mapLines;
  for (const l of mapLines) console.log(l);

  // 定点取样：区分「颜色错了」还是「几何/边缘错了」
  const PROBES: [string, number, number][] = [
    ["圆角矩形内部", 395, 232],
    ["圆角矩形左上角", 341, 215],
    ["圆角矩形右上角", 449, 215],
    ["文字笔画", 40, 124],
    ["文字第二行", 40, 143],
    ["径向渐变中心", 430, 128],
    ["径向渐变中环", 430, 145],
    ["线性渐变 1/4", 90, 248],
    ["线性渐变 1/2", 160, 248],
    ["线性渐变 3/4", 230, 248],
    ["星形内部", 376, 66],
    ["圆内部", 300, 190],
  ];
  const px = (d: Uint8ClampedArray | Uint8Array, lx: number, ly: number) => {
    const x = Math.min(PW - 1, Math.round(lx * RATIO));
    const y = Math.min(PH - 1, Math.round(ly * RATIO));
    const i = (y * PW + x) * 4;
    return `${d[i]},${d[i + 1]},${d[i + 2]}`;
  };
  for (const [name, x, y] of PROBES) {
    console.log(`PARITY_PX ${name} (${x},${y}) 原生=${px(nativeData, x, y)} 框架=${px(ours, x, y)}`);
  }

  const result = {
    backend: device.kind,
    msaa: target.sampleCount,
    ratio: RATIO,
    width: PW,
    height: PH,
    cssWidth: W,
    cssHeight: H,
    mean: Number(overall.mean.toFixed(3)),
    over16: Number((overall.over16 * 100).toFixed(2)),
    over48: Number((overall.over48 * 100).toFixed(2)),
    bestShift: [best.dx, best.dy, Number(best.mean.toFixed(3))],
    alphaMismatch,
    regions: Object.fromEntries(regions.map((r) => [r.name, Number(r.mean.toFixed(2))])),
  };
  // 控制台里也打一份，但探针经常在 Runtime.enable 之前就错过这行日志（页面加载比
  // CDP 连上还快），所以**以此处的全局变量为准**。
  (globalThis as Record<string, unknown>).__parity = result;
  console.log("PARITY_SELFTEST " + JSON.stringify(result));
}

const status = { err: "" };
(globalThis as Record<string, unknown>).__unidraw = {
  get status() {
    return { backend: params.get("backend") ?? "auto", err: status.err, fps: "", size: [W, H], frames: 1 };
  },
};

main().catch((e) => {
  status.err = e instanceof Error ? (e.stack ?? e.message) : String(e);
  errEl.textContent = status.err;
  console.log("PARITY_ERROR " + status.err);
});
