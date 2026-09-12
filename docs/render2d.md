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
- `fillText(text, x, y, maxWidth?)` / `strokeText(text, x, y, maxWidth?)`；
- `measureText(text)` 返回 `{ width, actualBoundingBox*, fontBoundingBox* }`（字段名与原生
  `TextMetrics` 对齐，`width` 是前进宽度）；
- `textAlign`（left/right/center/start/end）与 `textBaseline`
  （alphabetic/top/middle/bottom/hanging/ideographic），随 `save/restore` 压栈；
  - 水平对齐用**前进宽度**计算（`center` → 偏移 `width/2`），与原生一致；
  - `top/middle/bottom` 用 `fontBoundingBoxAscent/Descent`（em 盒）计算，
    `hanging/ideographic` 分别按 em 盒上/下沿近似 —— 与原生有**亚像素级**差异
    （对照页 textBaseline 分区平均差 ≈ 1.9/255）；
- `font` 设为 CSS font 简写；字形通过隐藏 2D canvas 栅格化为纹理并缓存
  （LRU，最多 96 个）；仅浏览器可用（`text.ts` 会给出明确错误）；
- `strokeText` 直接让浏览器 `strokeText` 栅格化**轮廓**，因此描边文字的
  圆角接头/尖角质量与原生一致（不是「把填充加粗」的近似）；
- 落点与原生一致：`actualBoundingBoxLeft/Ascent` 用来定位**图集左上角相对
  对齐点/基线**的偏移（`offsetX/offsetY`），不是直接当坐标用；
- `maxWidth` 通过横向压缩四边形实现（视觉等价于原生压缩字距）。

### 图片
- `drawImage(source, dx, dy)` / `(source, dx, dy, dw, dh)` /
  `(source, sx, sy, sw, sh, dx, dy, dw, dh)`（三种重载与原生一致）；
- 源可以是任意 `CanvasImageSource`（`Image` / `ImageBitmap` / `HTMLCanvasElement` /
  `ImageData`…），经 `textureFromImageSource` 采样为纹理并**按源对象缓存**
  （同一个 img/canvas 反复绘制只上传一次；源内容变了调用 `invalidateImage(source)`）；
- 绘制走纹理四边形 + `globalAlpha` + 当前合成模式，与 `fillStyle` 无关（与原生一致）；
- 缩放使用双线性采样：**轴对齐的 1:1 / 缩放 / 裁剪缩放逐像素与原生一致**；
  旋转后原生用更高质量的重建滤波（Skia），本实现是双线性，会有可见差异
  （对照实测旋转分区平均差 ≈ 9.6/255）。

### 合成模式
- `globalCompositeOperation`（随 `save/restore` 压栈）。**25 种全部支持**，分两条路径：
  - **硬件混合状态**（单 pass 完成，不需要把目标读成纹理）：
    - Porter-Duff 全家桶：`source-over` / `destination-over` / `source-in` / `destination-in` /
      `source-out` / `destination-out` / `source-atop` / `destination-atop` / `xor` /
      `lighter` / `copy`；
    - 可分离混合模式里能用混合因子/方程表达的：`multiply`（`dst` 因子）、
      `screen`（`one-minus-dst`）、`darken` / `lighten`（`min` / `max` 混合方程）；
  - **图层模式**（`blendPass.ts`）：`overlay` / `color-dodge` / `color-burn` /
    `hard-light` / `soft-light` / `difference` / `exclusion` / `hue` / `saturation` /
    `color` / `luminosity` —— 它们的 `B(Cb, Cs)` 必须以**目标为输入**，靠固定混合因子
    表达不出来。遇到这类 op，**整帧**改成「先画进自己的图层 → 最后呈现到调用方 pass」：
    该 op 的几何单独画进一张透明源图层，再由一个读 (dst, src) 两张纹理的着色器按
    W3C Compositing Level 1 的公式算出结果写回（ping-pong 两张图层轮换）。
    只有这一帧真的用到这些模式才会切，普通帧的路径完全不变（也保证 `Canvas2D`
    叠在 3D 场景上时照旧直接画进去）；
- 「源覆盖率为 0 的区域也要一起算」的模式（`copy` / `source-in` / `source-out` /
  `destination-in` / `destination-atop`）会额外画一块**路径补集**（画布矩形 − 路径，
  用 evenodd 求得）并带上同一混合状态，语义与原生一致；图层模式那 11 种在 `αs = 0`
  处公式本身就退化成恒等，不需要补集；
- 图层模式的**代价与边界**：多 2 张全屏目标 + 每张图层 op 多 2 个 pass（源图层、
  混合）；图层起点是透明底，所以「调用方 pass 的清屏色」不会被算进目标（帧内第一个
  op 之前的目标内容视为全透明），且图层的 html alpha 约定按直通 alpha 存储
  （rgb 预乘），呈现时用预乘 over，透明处保留调用方原有内容；
- `multiply`/`screen`/`darken`/`lighten` 的透明度处理是**硬件近似**：在**不透明底图**
  上与原生逐像素一致，半透明源与 W3C 的完整公式有微小差异（对照实测每格平均差 3~5/255）；
  图层模式那 11 种走的是完整公式，半透明源也一致（对照实测每格 ≤ 1.1）。

### 阴影
- `shadowColor` / `shadowBlur` / `shadowOffsetX` / `shadowOffsetY`（随 `save/restore` 压栈），
  `shadowColor` 全透明 = 不画阴影（与原生默认一致）；
- 实现是**真的高斯模糊**，不是「按权重重画 N 次」的近似：
  1. 把阴影几何（纯白 + 覆盖率）画进一张遮罩目标（独立 `submit`）；
  2. 横、竖各做一次 9-tap 可分离高斯（各一次独立 `submit`）；
  3. 回到调用方的 pass，用「阴影色 × 覆盖率」合成，再画本体。
  每一步必须独立 `submit`：同一 `submit` 内某张纹理不能既作附件写入又被只读采样；
- 半径对齐：原生 `shadowBlur` 的效果约等于 `σ = blur / 2`，而 9-tap 核自身
  `σ_k ≈ 2` 个步长，故取**步长 = blur / 4**；`shadowBlur = 0` 直接跳过模糊（硬阴影）；
- 阴影按**参数组**（颜色 + 模糊 + 位移）分开：每组一张遮罩，并在「该组第一个 op」的
  位置依次合成 —— 所以同一帧里 `shadowBlur = 0` 的硬阴影不会被另一组的半径带糊。
  两个坑值得记：合成位置早了会被本帧先画的背景 op 盖掉；**每组必须各留一份遮罩/结果
  纹理**（图层是当场 submit 的，合成却要等调用方 submit 才回放，共用一张会让所有合成
  读到最后一组的内容）；
- 遮罩按调用方的采样数建（MSAA 时硬阴影边缘才有抗锯齿），模糊那两趟固定写单采样目标；
- 阴影位移是在**用户空间**叠加的，实现里存 CTM 必须用副本（`copyAffine`）——直接存引用
  会让 `multiplyAffine` 就地写回，位移一路泄漏到后面每个 op。

### 虚线
- `setLineDash(segments)` / `getLineDash()` / `lineDashOffset`，随 `save/restore` 压栈；
- 按**弧长**在压平后的折线上推进，奇数长度的模式复制一遍（`[5]` ≡ `[5,5]`），
  闭合轮廓跨越起点继续；每段实线各自成段，因此 `lineCap` 对每段都生效。

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
- 尚未支持：`shadowColor` 使用 CSS 颜色里除 `#rgb/#rrggbb/#rrggbbaa` 与
  `rgb()/rgba()` 之外的写法（`hsl()`、颜色关键字等会按「不画阴影」处理）；
  裁剪仍只支持轴对齐矩形；**单独的** 阴影模糊半径大于约 60px 时 9-tap 核会出现
  轻微条带（连续多趟模糊可再改善）。
- **图案填充**：`repeat` / `repeat-x` / `repeat-y` / `no-repeat` 均与原生对齐
  （对照页 `?scene=pattern` 整幅 ≈ 0.70）。未重复的轴按原生语义在 `[0,1]` 之外裁成透明
  （CLAMP_TO_EDGE 采样会把边缘像素拉出去，所以着色器里额外做了裁剪）；
  图案用作**文字**填充时字形图集按顶点色渲染（未走图案），是已知差异。

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
nonzero 反向挖洞 / 自相交五角星），整幅平均差 ≈ 0.10，各分区 ≤ 0.32；
`?scene=extras` 验证虚线（不同 pattern/offset/线头）与文字 API
（textAlign / textBaseline / strokeText / measureText），整幅 ≈ 0.63，
其中虚线 0.18、textAlign 0.60、strokeText 0.49、textBaseline 1.91；
`?scene=composite` 验证 14 种硬件合成模式：9 种 Porter-Duff 模式**逐像素完全一致（0.00）**，
`copy` / `multiply` / `screen` / `darken` / `lighten` 平均差 3~5（圆边抗锯齿与
半透明混合的近似）；
`?scene=blend` 验证 11 种「以目标为纹理」的图层混合模式，整幅 ≈ 0.45，
各分区 0.31 ~ 1.09；
`?scene=shadow` 验证 `shadowColor/shadowBlur/shadowOffset`（模糊阴影 / 硬阴影 /
文字阴影 / 无阴影），整幅 ≈ 0.17，各分区 0.04 ~ 0.41；
`?scene=shadow1` 是**单阴影定位**场景（本体 + 阴影应在的位置 + 上下翻应在的位置），
用来判「阴影画到哪去了」，当前两边**逐像素完全一致（0.00）**；
`?scene=shadowblend` 把**阴影 + 图层混合放在同一帧**（两组阴影分别落在 ping-pong 前后），
用来守 WebGL2 的一个坑：同尺寸的多张 MSAA 目标曾经共用同一个 renderbuffer，
阴影遮罩一清屏就把图层中间结果抹掉，整幅几乎空白（WebGPU 不受影响）——
详见 [architecture.md §6.2](architecture.md)。当前两边一致（≈ 0.63）；
`?scene=image` 验证 `drawImage` 的三种重载 + 旋转 + 透明：轴对齐的 1:1 / 缩放 /
裁剪缩放 / 缩小平铺均为 **0.00**，只有旋转采样平均差 ≈ 9.6（滤波核差异）。

继续排查时应先看这张表：哪个区域掉下去，就说明对应图元的求值/栅格化方式跑偏了。

## 测试
纯 CPU 部分（压平/三角化/矩阵/样式采样）在 `src/__tests__/render2d.test.ts`
中覆盖；图层混合模式的**接线**（模式表、不再回退 source-over、只有用到图层模式才多开
pass）在 `src/__tests__/blend-modes.test.ts` 里用 `MockDevice` 断言，`npm test`
可直接运行（无需浏览器/GPU）；数值一致性靠 `examples/_verify-2d-parity`
（`npm run build:verify` + `node tools/parity-scenes.mjs`，一次跑完所有场景 × 两个后端）；
示例 `examples/shapes2d` 覆盖完整能力并在 WebGL2 / WebGPU 上无头验证。

> **跨后端一致性**：
> 1. `Canvas2D` 一帧里会同时使用两套顶点/索引缓冲（彩色图形 `flat` 与文本 `glyph`）。
>    WebGL2 的索引缓冲绑定是 **VAO 状态**，写缓冲时若不解绑 VAO 会把 flat 的索引绑定
>    改成 glyph 的，导致**整批彩色图形消失**（详情与修法见
>    [architecture.md §6.2](architecture.md)）。回归页 `examples/_verify-2d-clip`
>    （`npm run build:verify`）在两个后端上应逐像素完全一致。
> 2. 全屏拷贝的垂直方向在两个后端是相反的（见 `CopyPassOptions.flipY`）：
>    `Renderer` 把 MSAA 结果呈现到画布时必须按后端翻转，否则 WebGPU 整幅画面上下颠倒。
