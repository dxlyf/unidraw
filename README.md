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
| 内置材质 | `ColorMaterial` / `TextureMaterial`，自带 GLSL ES 3.00 + WGSL 双实现 |
| 内置几何 | box / plane / sphere / triangle / fullscreenTriangle |
| 数学库 | Vec2/3/4、Color、Mat4（perspective/ortho/lookAt/invert…），零依赖 |
| 测试 | 数学 / std140 / 格式表 / 几何生成 + **Mock 后端全流程集成测试**（`node --test`） |
| 示例 | 4 个可运行示例（同一源码切 WebGL2 / WebGPU 验证） |

零运行时依赖；开发依赖仅 `typescript`、`@webgpu/types`（类型）、`esbuild`（示例打包）。

---

## 快速开始

```bash
npm install            # 安装开发依赖
npm run typecheck      # 严格类型检查（src + examples + tests）
npm test               # 构建并运行全部测试（25 个用例，无需浏览器/GPU）
npm run build          # 产出 ESM 到 dist/
npm run build:examples # esbuild 打包示例到 dist-examples/
npm run serve          # 本地静态服务 → http://localhost:8080/
```

打开 http://localhost:8080/ 后选择任意示例。默认 **WebGPU 优先，WebGL2 兜底**；
用 URL 参数强制后端：`?backend=webgl2` / `?backend=webgpu`。

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

---

## 目录结构

```
src/
  math/        vec2/3/4、Color、Mat4、工具
  gpu/         types（统一枚举）、formats（顶点/纹理格式表）、std140 布局引擎
  device/      Device 抽象、资源句柄、descriptors、createDevice 工厂
    backend/   webgl2 / webgpu / mock（无头）
  command/     ops.ts（统一命令）、encoder.ts（CommandEncoder/RenderPassEncoder/CommandBuffer）
  render/      Geometry/primitives、UniformBlock、material（内置材质）、texture、
               Mesh、Camera、Renderer 门面、shaders（GLSL+WGSL）
  __tests__    node --test 测试
examples/      4 个示例 + common/demo.ts 引导
tools/         零依赖静态服务、esbuild 示例打包
docs/          中文文档（见下）
```

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
