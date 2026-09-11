# render2d —— 框架级 2D 绘图模块

`Canvas2D` 提供类 Canvas2D 的即时模式 2D 绘制 API，且与 WebGL2 / WebGPU
共用同一套实现（三角形由 CPU 端生成，动态合批后以少量 `drawIndexed` 提交）。

## 快速上手

```ts
import { createDevice, Canvas2D, LinearGradient } from "unidraw";
import { Mat4 } from "unidraw";

const device = await createDevice({ canvas, backend: "auto" });
const c2d = new Canvas2D(device);
const pass = /* 每帧 beginFrame 得到的 RenderPassEncoder */;

// 每帧：
c2d.setViewportSize(canvas.width, canvas.height);
c2d.begin();

c2d.fillStyle = "#ff5c7a";
c2d.beginPath();
c2d.roundRect(20, 20, 160, 90, [40, 8, 8, 40]);
c2d.fill();

c2d.fillStyle = new LinearGradient(0, 200, 400, 200).addColorStop(0, "#4c8dff").addColorStop(1, "#35d7ee");
c2d.fillRect(20, 240, 300, 60);

c2d.save();
c2d.translate(400, 300);
c2d.rotate(time);
c2d.fillStyle = "#f5d02e";
c2d.fillRect(-40, -40, 80, 80);
c2d.restore();

c2d.font = "600 28px system-ui";
c2d.fillStyle = "#f2f5ff";
c2d.fillText("你好 2D", 40, 420);

c2d.flush(pass, Mat4.ortho(0, canvas.width, canvas.height, 0, -1, 1));
```

坐标体系：**像素坐标、原点左上**（由你传入的 `Mat4.ortho(0,w,h,0,…)` 决定），
与示例保持一致。

## 能力清单

### 路径
- `rect` / `roundRect`（半径可为数值或 `[tl,tr,br,bl]`）
- `moveTo/lineTo`、`quadraticCurveTo`、`bezierCurveTo`
- `arc`（圆/圆弧，含方向）、`arcTo`、`ellipse`（旋转椭圆）、`closePath`
- 曲线按容差**自适应细分**（`flatten(tolerance)`）

### 填充与描边
- `fill(rule?)`：`rule` 为 `"nonzero"`（默认，与原生一致）或 `"evenodd"`。
  多子路径会**按规则求出精确的填充区域**再拆成互不重叠的三角形：
  内环挖洞、重叠子路径只覆盖一次（半透明不会出现深色缝）、自相交路径（一笔画五角星）
  也正确；
  - 单轮廓且不自相交时走耳切法（三角形最少）；
  - 其余情况走**扫描线梯形分解**：事件 y = 顶点 y + 所有边交点 y，带内按 x 排序后
    用填充规则配对成内部区间，每段插值成梯形。边数超过 1024 会退回逐轮廓耳切
    （避免病态输入 O(n²) 爆炸）；
- `stroke()`：线宽 / `lineCap`(butt/round/square) / `lineJoin`(miter/round/bevel)
  / `miterLimit`（同一路径的线段/接头仍是**各自覆盖**，半透明描边在接头处会比原生略深）
- 便捷：`fillRect/strokeRect/fillCircle/strokeCircle`

### 样式
- `fillStyle / strokeStyle`：十六进制字符串 / `Color` / `LinearGradient`
  （多点 stops）/ `RadialGradient`；
- 渐变**逐像素求值**：顶点只带「用户空间坐标 + 渐变几何」，片元里算 `t` 再查
  512×1 的 LUT 纹理。LUT 由浏览器自己的 `CanvasGradient` 光栅化，所以 stop 之间的
  插值空间/取整规则与原生 Canvas2D **一致**；图元怎么三角化都不影响结果
  （早期版本按顶点采样颜色，多 stop 线性渐变会整体偏移、径向渐变只会画出最外圈）；
- 渐变随 CTM 一起形变（按用户空间求值），缩放后的圆仍然是「用户空间里的正圆」，
  与原生一致；
- `globalAlpha`、`lineWidth`…

### 变换与层级
- `translate / scale / rotate / setTransform / resetTransform`
- `save() / restore()` 保存整份状态：CTM、样式、透明度、线属性、字体与裁剪
- 画布内重叠即“层级”，绘制顺序即 z 序

### 裁剪
- `clipRect(x,y,w,h)` 与 `clip()`（要求当前路径是轴对齐矩形路径）；
- 裁剪为**设备空间 scissor**，可与 `save/restore` 嵌套求交；
- 说明：任意路径裁剪需要 stencil 支持，暂未开放。

### 文本
- `fillText(text, x, y)`（以基线 y 对齐；默认左对齐）
- `font` 设为 CSS font 简写；字形通过隐藏 2D canvas 栅格化为纹理并缓存
  （LRU，最多 96 个）；仅浏览器可用（`text.ts` 会给出明确错误）
- 落点与原生一致：`actualBoundingBoxLeft/Ascent` 用来定位**图集左上角相对
  对齐点/基线**的偏移（`offsetX/offsetY`），不是直接当坐标用；
- 文本颜色跟随 `fillStyle`（纯色/渐变都会采样到四边形顶点）；
- 文字的抗锯齿来自「在分数像素位置绘制图集纹理 + 线性采样」，与原生
  Canvas2D 的次像素定位观感一致。

### 抗锯齿
- 曲线/斜边/细描边的锯齿由 **MSAA** 解决，默认跟随 `Renderer` 的 `msaa`（默认 4）；
  `Canvas2D` 的管线会按 `pass.sampleCount` 自动选取对应采样数的版本
  （WebGPU 会严格校验管线与附件的采样数必须一致）；
- `RendererOptions.msaa = 1` 可关掉（性能档位示例就是这么做的）。

### 性能
- 每帧 CPU 三角化 → 单个动态缓冲 + 按 op 顺序（裁剪分段）少量 draw；
- 顶点 64B（位置 + 顶点色 + 用户空间坐标 + 渐变几何）；
- 渐变 LUT 按 `kind + stops` 缓存（512×1，最多 64 个），同参数重复创建只光栅化一次。

## 已知边界（v0.1）
- 裁剪仅限轴对齐矩形；路径级/任意形状裁剪未实现；
- `stroke()` 的线段/接头是各自覆盖（**不支持**把整条描边当作一个区域只覆盖一次），
  半透明粗描边在接头处会比原生略深；
- 圆角 join 用扇形逼近；
- 字形纹理在 DPR>1 时以设备像素栅格化（缩小绘制可能略糊，可后续按 DPR 缓存）；
- 尚未支持：`lineDash`、`shadowBlur`、`drawImage`/`createPattern`、
  `globalCompositeOperation`（这些在框架层可以直接用渲染目标/混合模式自己搭）。

## 与原生的差距（量化）

`examples/_verify-2d-parity`（`npm run build:verify`）用**同一段绘制脚本**分别喂给
原生 `CanvasRenderingContext2D` 与 `Canvas2D`，逐像素比较（预乘空间），并按图元类型
分区给出指标。当前结果（480×270、msaa=4，两个后端基本一致）：

| 区域 | 平均通道差 | 备注 |
| --- | --- | --- |
| 整幅 | ≈ 0.55 / 255 | `>48` 的像素 ≈ 0.03% |
| 线性渐变（5 stop） | 0.30 | |
| 径向渐变 | 0.50 | |
| 圆角矩形（四角不同半径） | 0.27 | |
| 圆 / 旋转椭圆 | 0.60 | |
| 星形（凹多边形） | 0.78 | |
| 粗贝塞尔描边 / 文字 | 0.50 ~ 0.57 | |
| 1.2px 细线 | 1.31 | 亚像素栅格化差异，两端都会略有不同 |

另有 `?scene=fillrules` 场景专门验证多子路径填充规则（重叠并集 / evenodd 挖洞 /
nonzero 反向挖洞 / 自相交五角星），整幅平均差 ≈ 0.10，各分区 ≤ 0.32。

继续排查时应先看这张表：哪个区域掉下去，就说明对应图元的求值/栅格化方式跑偏了。

## 测试
纯 CPU 部分（压平/三角化/矩阵/样式采样）在 `src/__tests__/render2d.test.ts`
中覆盖，`npm test` 可直接运行；示例 `examples/shapes2d` 覆盖完整能力并在
WebGL2 / WebGPU 上无头验证。

> **跨后端一致性**：
> 1. `Canvas2D` 一帧里会同时使用两套顶点/索引缓冲（彩色图形 `flat` 与文本 `glyph`）。
>    WebGL2 的索引缓冲绑定是 **VAO 状态**，写缓冲时若不解绑 VAO 会把 flat 的索引绑定
>    改成 glyph 的，导致**整批彩色图形消失**（详情与修法见
>    [architecture.md §6.2](architecture.md)）。回归页 `examples/_verify-2d-clip`
>    （`npm run build:verify`）在两个后端上应逐像素完全一致。
> 2. 全屏拷贝的垂直方向在两个后端是相反的（见 `CopyPassOptions.flipY`）：
>    `Renderer` 把 MSAA 结果呈现到画布时必须按后端翻转，否则 WebGPU 整幅画面上下颠倒。
