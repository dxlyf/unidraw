# UniDraw

> 一套**统一绘制命令**的 TypeScript 图形框架：同一份源码、同一个命令 API，
> 同时运行在 **WebGL2** 与 **WebGPU** 之上。
>
> 高性能（UBO 驱动 / VAO 缓存 / 命令批提交）· 易用（几何体 + 材质 + 相机）
> · 可扩展（三后端、统一命令可序列化、新增后端只需实现 `Device`）。

---

## 特性一览

| 能力 | 说明 |
| --- | --- |
| 统一资源与命令 | `Buffer / Texture / Sampler / Program / RenderPipeline / BindGroup` 与 `beginRenderPass → setPipeline → setBindGroup → draw…` 全部与后端无关 |
| 三种后端 | **WebGL2**（完整实现）、**WebGPU**（完整实现）、**Mock**（无头 CPU 后端，Node 单测用） |
| 一套 UBO | `std140` 布局引擎同时驱动 GLSL `layout(std140)`、WGSL uniform 与 CPU 侧打包 |
| 内置材质 | `ColorMaterial`(Lambert) / `UnlitColorMaterial` / `PhongMaterial`(Blinn-Phong 高光) / `TextureMaterial`，自带 GLSL ES 3.00 + WGSL 双实现，支持 alpha 混合/双面/材质参数 |
| 内置几何 | box / plane / sphere / triangle / fullscreenTriangle + **cylinder(圆台/封口)/ cone / torus / capsule** |
| 数学库 | Vec2/3/4、Color、Mat4（perspective/ortho/lookAt/invert…），零依赖 |
| 测试 | 数学 / std140 / 格式表 / 几何生成 + **Mock 后端全流程集成测试**（`node --test`） |
| 示例 | 9 个可运行示例（同一源码切 WebGL2 / WebGPU），含 **2D 绘制**、**3D 材质与几何画廊**与 3 个**性能档位循环**示例 |

零运行时依赖；开发依赖仅 `typescript`、`@webgpu/types`（类型）、`esbuild`（示例打包）。

---

## 快速开始

```bash
npm install            # 安装开发依赖
npm run typecheck      # 严格类型检查（src + examples + tests）
npm test               # 构建并运行全部测试（34 个用例，无需浏览器/GPU）
npm run build          # 产出 ESM 到 dist/
npm run build:examples # esbuild 打包示例到 dist-examples/
npm run serve          # 本地静态服务 → http://localhost:8080/
```

打开 http://localhost:8080/ 后选择任意示例。默认 **WebGPU 优先，WebGL2 兜底**；
用 URL 参数强制后端：`?backend=webgl2` / `?backend=webgpu`。

### 2D 绘制（框架模块 `src/render2d` + 示例 `examples/shapes2d`）

框架内置了 Canvas2D 风格的 **`Canvas2D` 模块**（`src/render2d/`），
WebGL2 / WebGPU 共用一套实现：

- 路径：`rect / roundRect / line / quadraticCurveTo / bezierCurveTo /
  arc / arcTo / ellipse / closePath`（曲线自适应细分）；
- 填充与描边：`fill()`（凸/凹多边形、耳切）/ `stroke()`（`lineCap`
  butt·round·square，`lineJoin` miter·round·bevel，`miterLimit`，`lineWidth`）；
- 样式：十六进制 / `Color` / `LinearGradient`（多点）/ `RadialGradient`(近似)，
  `globalAlpha`；
- 变换与层级：`translate / rotate / scale / setTransform` + `save()/restore()`
  （连同样式、字体、裁剪一起压栈）；
- 裁剪：`clipRect` / `clip()`（轴对齐矩形，设备空间 scissor，可嵌套）；
- 文本：`fillText` + `font`（隐藏 canvas 栅格化字形 → 纹理缓存、随 fillStyle 着色）；
- 性能：CPU 三角化 → 动态合批，每帧少量 `drawIndexed`。

`examples/shapes2d` 展示了上述全部能力（含动画与裁剪层叠）。
模块用法与边界见 [docs/render2d.md](docs/render2d.md)。

### 3D 材质与几何

框架内置更多 3D 素材（`src/render/`）：

- **材质**：`ColorMaterial`（Lambert 漫反射）、`UnlitColorMaterial`（无光照纯色）、
  `PhongMaterial`（Blinn-Phong 高光：`shininess / specular / ambient` 参数，
  需要传入相机位置）、`TextureMaterial`（纹理 × Lambert）；统一支持
  `alphaBlend` 半透明与双面（`cullMode`）；
- **几何**：`cylinder`（上下半径可不同=圆台，可封口/开口）、`cone`、`torus`、
  `capsule`，全部带正确 UV/法线与朝外绕序（内置自检工具修正）；
- 示例 `examples/shapes3d` 以画廊形式展示几何 × 材质组合并旋转。

### 性能示例

三个性能示例会自动循环各档位测量（`examples/common/bench.ts` 提供的统一测量框架）：

| 示例 | 测量什么 | 档位 |
| --- | --- | --- |
| `perf-drawcalls` | 每物体一次 draw 的 CPU 开销（含 UBO 提交与绑定） | 500 → 6000 个立方体 |
| `perf-instanced` | 单 draw 内实例化吞吐（顶点/光栅压力） | 4 096 → 262 144 个实例 |
| `perf-triangles` | 高细分网格的三角形吞吐 | 32×16 → 224×112 细分 ×4 份 |

- 每档先预热 12 帧，再取 90 帧窗口平均，右上角逐档显示 ms / fps；
- 点击档位可手动停留，**空格**暂停/继续自动循环；
- 渲染分辨率固定为 CSS 像素（可 `?scale=2`），保证不同档位可比。

### 一个最小例子（与后端无关）

```ts
import { createDevice, Renderer } from "unidraw";

const canvas = document.querySelector("canvas")!;
const renderer = await Renderer.create(canvas, { backend: "auto" });

const geometry = Geometry.create(device, box());
const material = new ColorMaterial(device, new Color().setHex("#4c8dff"));
const mesh = new Mesh(geometry);

function frame() {
  const pass = renderer.beginFrame();
  material.beginFrame(camera.viewProjection);
  mesh.model.rotateY(0.01);
  material.draw(pass, mesh);
  renderer.endFrame();
  requestAnimationFrame(frame);
}
frame();
```

> 同一段代码在 WebGL2 与 WebGPU 下给出相同画面 —— 这就是“统一绘制命令”。

### 故障排查

- WebGPU 渲染为空时优先看控制台：框架会**无条件打印** WGSL 编译诊断
  （`[unidraw] WGSL 编译诊断`）与校验错误（`[unidraw] WebGPU validation error`）。
- 常见陷阱：渲染通道带**深度附件**时，参与该 pass 的每条管线都必须声明匹配的
  `depthStencil`（WebGPU 校验规则）。纯 2D 绘制请关闭深度：
  `new Renderer(canvas, { depth: false })`，或在 URL 后加 `?depth=0` 对比。
- 无头验证（无需真实显示器/GPU，SwiftShader）：
  ```bash
  EXTRA_CHROME_FLAGS=--enable-unsafe-swiftshader \
    node tools/browser-probe.mjs "http://localhost:8080/triangle/index.html?backend=webgpu" wgpu
  node tools/pngprobe.mjs shot-wgpu.png   # 像素统计
  ```

---

## 目录结构

```
src/
  math/        vec2/3/4、Color、Mat4、工具
  gpu/         types（统一枚举）、formats（顶点/纹理格式表）、std140 布局引擎
  device/      Device 抽象、descriptors、createDevice 工厂
    resource/  一个类一个文件（ResourceBase/Buffer/Texture/TextureView/Sampler/
               Program/BindGroupLayout/BindGroup/RenderPipeline）
    resources.ts  barrel：保持 `device/resources.js` 导入路径不变
    backend/   webgl2 / webgpu / mock（无头）
               constants.ts + gpuUtils.ts + resources/<每类一个文件> + <Backend>Device.ts
  command/     ops.ts（统一命令）、CommandBuffer / RenderPassEncoder / CommandEncoder
               （encoder.ts 为 barrel，保持 `command/encoder.js` 不变）
  render/      Camera、Geometry、Mesh、UniformBlock、Renderer 门面
    material.ts / shaders.ts / primitives.ts / texture.ts 均为 barrel；
    实现按「一个类/一个几何体/一份材质一个文件」放在同目录或子目录
    （materialCommon.ts、shaders/*、primitives/*、texture/*）
  render2d/    Canvas2D 完整 2D：路径/贝塞尔/arc/圆角矩形、填充描边、渐变、
               变换、文本、裁剪（WebGL2/WebGPU 共用）
               path.ts / style.ts / renderer2d.ts 为 barrel，实现拆到
               Path2D.ts、pathTypes.ts、color.ts、LinearGradient.ts、
               RadialGradient.ts、paint.ts、Canvas2D.ts、types.ts、geometry2d.ts
  __tests__    node --test 测试
examples/      9 个示例 + common/（demo 引导、bench 测量框架）
tools/         零依赖静态服务、esbuild 示例打包
docs/          中文文档（见下）
```

> 约定：**一个文件一个类/一个职责**，跨模块引用一律走同名 barrel
> （`device/resources.js`、`command/encoder.js`、`render/material.js`、
> `render/shaders.js`、`render/primitives.js`、`render2d/path.js` …），
> 因此重构文件布局不会影响使用方导入路径。

---

## 设计速览

- **统一命令流**：所有绘制被记录为与后端无关的 op 列表（`command/ops.ts`），
  提交时由各后端翻译执行。CommandBuffer 不可变、可重放、可被测试/序列化。
- **Uniform 全部走 UBO**：内置材质没有 `uniform1f` 之类逐字段调用；
  布局由 `std140` 引擎统一推导（GL/WGSL/CPU 三方一致）。
- **BindGroup 等价物**：WebGL2 后端在创建 BindGroupLayout 时静态分配
  UBO binding point / 纹理单元，绑定资源即 `bindBufferBase` + `bindTexture`。
- **WebGPU 语义对齐**：命令/管线/绑定模型按 WebGPU 设计，WebGL2 是翻译层。
  深度测试跨后端一致（WebGL2 用默认帧缓冲深度；WebGPU 用设备内部深度纹理）。

详细内容见 [docs](docs/)：

- [架构与设计](docs/architecture.md)
- [统一绘制命令规范](docs/command-spec.md)
- [render2d 2D 绘图模块](docs/render2d.md)
- [着色器写作指南](docs/shader-guide.md)
- [扩展指南（新后端 / 新材质 / 新示例）](docs/extension.md)

---

## 路线图（可能的后续）

- 计算管线 / 存储缓冲 / indirect draw
- 离屏渲染与后处理便捷封装（低层能力已具备，见 extension 文档）
- 纹理压缩格式、多采样、mipmap 自动生成
- 更完整的数学（四元数、AABB、射线）
- WebGPU 原生 GPU 队列级编码（当前在 submit 时翻译统一命令，换取三后端一致性）

## License

MIT
