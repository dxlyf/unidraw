# 扩展指南

> 代码组织约定：**一个文件一个类/一个职责**，模块入口用同名 barrel 保持导入路径稳定
> （例如 `render/material.ts` 只 re-export 同目录的 `BaseMaterial.ts` / `ColorMaterial.ts` …）。
> 新增内容时请放到独立文件并在 barrel 里补一行，而不是塞进已有文件。

## 1. 新增一种材质

内置模板见 `src/render/BaseMaterial.ts`（+ 同目录 `ColorMaterial.ts` 等具体材质）。
最小步骤：

1. 成对编写 shader（`src/render/shaders/<名字>.ts`，或直接写在业务文件），遵守
   [着色器指南](shader-guide.md) 的 bind group / 顶点约定；
2. `device.createProgram({ glsl, wgsl })`；
3. 继承 `BaseMaterial`（自动获得标准 layout + 动态偏移模型矩阵环形 UBO）并实现
   `createBindGroup()`（用 `this.baseBindGroupEntries()` 拿标准 0/1/2 binding）；
4. 额外常量放进自己的 `UniformBlock`（std140），在 `beginFrame` / 参数变化时 `flush()`；
5. 暴露 `draw(pass, mesh)` / `drawGeometry(pass, geometry, model)`（基类已提供）。

> 用 UBO 而非 uniform1f 上传常量，以获得 WebGL2 后端的最优路径；
> 需要「逐物体」变化的量时不要写进材质 UBO，而是照 `IdMaterial` 的做法
> 用 `hasDynamicOffset` 的环形块（见 `docs/architecture.md` 第 3.1 节）。

## 2. 新增一种几何体

在 `src/render/primitives/` 下新增一个文件（例如 `prism.ts`），导出生成
`GeometryData` 的函数，并在 `src/render/primitives.ts` barrel 里补一行
（`positions` 必填、`normals/uvs/indices` 可选），然后：

```ts
const data = myShape(1, 2);
const geo = Geometry.create(device, data);
```

`Geometry` 会按标准布局交错上传；材质按需声明 attribute 子集。
若你的材质使用不同顶点格式，可脱离 `Geometry`，自行 `device.createBuffer` +
自定义 `VertexStateDescriptor`（参考 instancing 示例）。

> 新几何体请补一个「体积/包围盒/法线单位化」单测：`primitives.test.ts` 里的
> `signedVolume()` 能同时抓住「面没放对位置」和「绕序朝内」两类错误；
> `topology()` 则断言「无边界边（没有洞）/无零面积三角形/无非流形边」——
> 极点（球、圆锥、胶囊顶点）最容易漏盖，务必用扇形三角形而不是退化的四边形。

## 3. 新增一个插件 / 应用逻辑

业务应用建议直接用 `App`（见 [docs/app.md](app.md)）：

```ts
app.use(definePlugin({
  name: "my-plugin",
  setup(ctx) { /* 建资源、注册输入监听 */ },
  update(ctx, dt, time) { /* 每帧逻辑 */ },
  beforeRender(ctx, pass) { /* 自定义 pass / 描边 */ },
  dispose(ctx) { /* 释放 */ },
}));
```

需要自定义绘制时用 `ctx.sceneRenderer.collectVisible(scene, camera)` 复用主渲染的
剔除/排序结果，避免重复遍历场景。

## 4. 离屏渲染（render-to-texture）与后处理

**推荐直接用 `RenderTarget` + `EffectComposer`**（自动处理 MSAA/解析/回读/呈现格式）：

```ts
import { RenderTarget, EffectComposer, BloomPass, ToneMapPass, FullScreenPass } from "unidraw";

const composer = new EffectComposer(device, { width, height, sampleCount: 4 });
composer.addPass(new BloomPass(device, { threshold: 0.65 }));
composer.addPass(new ToneMapPass(device, { mode: "aces", exposure: 1.15 }));
composer.render((pass) => sceneRenderer.render(pass, scene, camera));
```

自定义效果继承 `FullScreenPass`，给一对 fragment 源码即可（见
[docs/postfx.md](postfx.md) §3.3）；多趟效果用 `ctx.encoder` 自己开内部 pass，
最后用 `ctx.beginOutputPass()` 合成（**不要嵌套 pass**）。

底层也可以手动组合：

```ts
const rt = device.createTexture({ width, height, format: "rgba8unorm",
  usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_SRC });
const depth = device.createTexture({ width, height, format: "depth24plus",
  usage: TextureUsage.RENDER_ATTACHMENT });

const enc = device.createCommandEncoder();
const pass = enc.beginRenderPass({
  colorAttachments: [{ view: rt.view(), loadOp: "clear", storeOp: "store", clearValue: ... }],
  depthStencilAttachment: { view: depth.view(), depthLoadOp: "clear", depthStoreOp: "store" },
});
// … 绘制场景 …
pass.end();

// 第二个 pass 把 rt 采样到 canvas（view: null）
device.submit([enc.finish()]);
```

采样侧需要一张纹理材质；也可以直接写全屏三角形 blit。
WebGL2 后端按 `(colorTexture, depthTexture)` 缓存 FBO。
读回结果用 `await device.readTexturePixels(rt, { x, y, width, height })`（三后端一致）；
`ColorPicker` 就是这么实现 GPU 颜色拾取的，可直接参考。

## 5. 新增一个后端

实现 `src/device/Device.ts` 的抽象类即可（约 10 个 create* + `executeOps` + 4 个查询 +
`readTexturePixels`）：

1. `Device` 子类持有原生上下文（如 `WebGL2Device.gl` / `WebGPUDevice.gpu`）；
2. 在 `src/device/resources.ts` 的资源基类上派生原生包装
   （`Buffer/Texture/Sampler/Program/BindGroupLayout/BindGroup/RenderPipeline`），
   放在 `src/device/backend/<后端>/resources/` 下（一个类一个文件），
   构造时 `device.register(this)` 纳入统一生命周期；
3. 在 `executeOps` 里逐条翻译统一命令（注意动态偏移 `setBindGroup` 的 offsets）；
4. 在 `createDevice.ts` 登记候选与降级顺序；
5. 用同一套 Node 单测（跑在 Mock 上）作为行为基准自测。

## 6. 命令层的可移植性

`command/ops.ts` 中每条命令只是普通 JSON 化的对象（引用句柄），因此：

- 可在 worker/主线程间传递（句柄换成 id 后即可序列化，便于远程渲染）；
- 可离线录制/回放（demo/自动截图/一致性测试）；
- 可做批处理与重放优化（同一 CommandBuffer 提交多次）。

## 7. 扩展设备层（新资源维度 / 新命令 / 新能力）

### 7.1 通用模式：一个能力要动的地方

框架的分工是固定的，加任何设备层能力都是同一条路径：

| 层 | 文件 | 要做的事 |
| --- | --- | --- |
| 描述符 | `device/descriptors.ts` | 加字段 / 加 union 成员（如新的 `BindGroupEntryType`） |
| 统一类型 | `gpu/types.ts`、`gpu/formats.ts` | 新的 usage 标志 / 格式（含 `bytesPerTexel` 等元信息） |
| 资源基类 | `device/resource/*.ts` | 新资源类型的抽象类（暴露的方法就是三个后端要实现的方法） |
| 设备 API | `device/Device.ts` | 新增 `abstract createXxx()`（三个后端必须各实现一次） |
| 命令 | `command/ops.ts`、`command/encoder.ts` | 新命令加进 `CommandOp` union + encoder 上加对应方法 |
| 后端 ×3 | `backend/webgpu/*`、`backend/webgl2/*`、`backend/mock/*` | 各实现一次；**Mock 也一定要实现**（Node 测试只跑 Mock，漏了就静默不覆盖） |
| 上层封装 | `render/*`（材质 / RenderTarget / pass） | 把能力包成好用的类 |

`BufferUsage.STORAGE | INDIRECT`、`TextureUsage.STORAGE_BINDING`、`ShaderStage.COMPUTE`
这些标志**已经在了**，WebGPU 的 usage 映射（`backend/webgpu/gpuUtils.ts`）也已经写好 ——
缺的是命令层与各后端的实现。

### 7.2 Storage buffer（SSBO / storage）

1. `descriptors.ts`：`BindGroupEntryType` 加 `"storage" | "readonly-storage"`；
2. WebGPU：`createBindGroupLayout` 映射成 `{ buffer: { type: "storage" | "read-only-storage" } }`，
   `createBindGroup` 里 buffer + `offset/size`（描述符里已有这两个字段，动态偏移也已有）；
3. **WebGL2 没有 SSBO**（`glUtils.ts` 里现在把 `BufferUsage.STORAGE` 映到 `0x90d2`
   `SHADER_STORAGE_BUFFER`，那是 GL 4.3 的枚举，WebGL2 里不存在）—— 只能二选一：
   抛「本后端不支持」让上层降级，或者用**纹理模拟**（`rgba32float` + `texelFetch` 读、
   FBO 渲染写），这也是 WebGL2 上做 GPGPU 的常规做法；
4. 材质侧：`render/material.ts` / `BaseMaterial.ts` 的 binding 声明表里加 storage 条目。

### 7.3 计算管线（compute）

1. `descriptors.ts`：`ProgramDescriptor` 加 `wgsl.compute`（`computeEntryPoint`）；
   GLSL ES 3.00 **没有 compute**，所以这个能力天然只有 WebGPU；
2. `Device.ts`：加 `abstract createComputePipeline(desc)`；
   `command/ops.ts` 加 `{ k: "dispatchWorkgroups"; x; y; z }`，`encoder.ts` 加 `dispatch()`；
3. WebGPU：`createComputePipeline` + `beginComputePass/setPipeline/setBindGroup/dispatchWorkgroups`，
   与 render pass 在同一个 encoder 里交错（回放顺序即提交顺序）；
4. **WebGL2 的正确说法**：WebGL2 **没有** compute shader，也没有任何浏览器扩展提供它
   （`gl.dispatchCompute` 是 WebGL 2.0 里不存在的东西）。要在 WebGL2 上做同类计算只有两条路：
   **变换反馈**（`transformFeedbackVaryings` + `beginTransformFeedback`，框架目前未接）或
   **纹理 GPGPU**（渲染到浮点目标，再 `texelFetch` 读结果）。所以跨后端的功能设计要按
   「WebGL2 走纹理 GPGPU / WebGPU 走 compute」写两套，或者把该功能标为 WebGPU-only；
5. Mock：只记录边界（保证 Node 测试能跑通调用链）。

### 7.4 Indirect draw

1. `command/ops.ts` 加 `{ k: "drawIndirect"; buffer; offset; indexed }` + `encoder.ts` 方法；
2. WebGPU：直接 `drawIndirect / drawIndexedIndirect`（buffer 需要 `BufferUsage.INDIRECT`，标志已有）；
3. WebGL2：**没有** `drawElementsIndirect`（那是 GL 4.3 / WebGPU 的能力）—— 只能
   「读回参数再用普通 draw 发一遍」：需要给 `Device` 加一个同步的 `readBuffer`（WebGL2 用
   `getBufferSubData`，WebGPU 走 staging buffer + `mapAsync`），或者直接不支持；
4. 它的典型用途（GPU 剔除、粒子）通常要和 7.2/7.3 配合，建议一起做。

### 7.5 纹理维度：3D / array / cube

这是**收益最高**的一项（点光 cube map 阴影、图集、体纹理都卡在这里）：

1. `TextureDescriptor` 加 `dimension?: "2d" | "3d" | "cube" | "2d-array"` 与
   `depthOrArrayLayers?: number`；
2. `resource/Texture.ts` 加对应只读字段，`createDefaultView()` 按维度建视图
   （`GLTextureView` / `WebGPUTextureView` 各改一处）；
3. WebGPU：`createTexture({ dimension, depthOrArrayLayers })` + `baseArrayLayer/arrayLayerCount`；
4. WebGL2：`glUtils.ts` 里加 `TEXTURE_3D / TEXTURE_2D_ARRAY / TEXTURE_CUBE_MAP` 目标映射，
   `GLTexture._allocate` 走 `texStorage3D`（cube 用 6 个面的 `texImage2D`）；
   `TextureUploadOptions` 加 `z / layer / face` 与每层字节数，上传走 `texSubImage3D`；
5. `render/RenderTarget.ts` 现在假设「2D 单层」（`colorAttachment` 一个 view）：
   要支持分层渲染就给它加 `layer`/`face`，把附件 view 的 `baseArrayLayer` 指过去 ——
   这一条做完，**点光 cube map 阴影**（`docs/shadows.md` 里那条「暂不支持」）就只差
   每面各跑一趟深度 pass 了。

### 7.6 压缩纹理（BC / ETC2 / ASTC）

1. `gpu/types.ts` 的 `TextureFormat` 加格式名，`gpu/formats.ts` 的 `textureFormatInfo` 补
   「块大小 / 每块字节数」（现在假设未压缩，`bytesPerTexel` 的语义要扩展成块）；
2. WebGPU：`writeTexture` / `copyExternalImageToTexture` 直接支持；WebGL2 走
   `compressedTexImage2D` + 扩展检测（`WEBGL_compressed_texture_s3tc/etc2/astc`），
   `GLTexture.upload` 加一条分支；
3. 记得标注**能不能渲染/能不能 MSAA**（WebGL2 上压缩纹理做渲染目标基本不行），
   否则用户会在 attachment 处踩到「Framebuffer 不完整」。

### 7.7 回读扩展（浮点 / 深度）

现在 `readTexturePixels` 只支持 8bit 颜色（WebGL2 `gl.readPixels` + 行翻转/BGRA swizzle）。
要做 HDR/深度回读：

- `ReadPixelsOptions`（`device/readback.ts`）加 `type: "uint8" | "float32" | "float16"`；
- WebGL2：`gl.readPixels(FLOAT)` 需要 `EXT_color_buffer_float` 之类的扩展检测（读本身可以，
  关键是目标格式能不能挂 FBO）；输出仍是行翻转；
- WebGPU：**必须**先把纹理 `copyTextureToBuffer` 到一张 `COPY_DST | MAP_READ` 的 staging buffer，
  再 `queue.readBuffer`（`mapAsync` + 等 `onSubmittedWorkDone`），并按 `bytesPerRow` 256 对齐
  逐行解析 —— 这条路径框架里还没有，是 WebGPU 上回读浮点/深度的唯一办法。

### 7.8 采样器与 mipmap 的两个漏项

- `SamplerDescriptor` 加 `maxAnisotropy`：WebGPU 一行；
  WebGL2 没有 sampler 对象（框架是「采样器状态落在纹理上」），要在 `GLTexture` 上设
  `TEXTURE_MAX_ANISOTROPY_EXT`（先查 `EXT_texture_filter_anisotropic`）；
- WebGPU 的 `generateMipmaps()`：逐级降采样需要每个 mip 一张 `TextureView(baseMipLevel)`，
  用现成的 `FullScreenPass` 写一个 `MipmapPass` 逐级 blit 即可
  （`copyTextureToTexture` 只能整级拷贝、不滤波，不要用它降采样）；WebGL2 直接
  `gl.generateMipmap` ✓ 已实现。

### 7.9 优先级与三条经验

建议顺序：**7.5 纹理维度 > 7.7 回读 > 7.6 压缩纹理 > 7.8 > 7.2/7.3/7.4（compute 系）**。
前两项是「能不能用」，compute 系是「换个架构」，而且 WebGL2 天然残缺。

三条这个项目踩出来的经验，扩展时请务必遵守：

1. **新 op / 新资源，三个后端都要实现**，Mock 不实现就会被 Node 测试静默漏掉；
2. **新增一趟内部采样 pass，就要重新检查上下翻转**：WebGL2 与 WebGPU 的行序相反，
   同一个 pass 实例的翻转补偿依赖「内部采样趟数」的奇偶性 —— 多一趟或少一趟都可能让
   某一端整幅上下颠倒。加完 pass 记得跑 `node tools/parity-scenes.mjs`（两个后端 + 13 个场景）；
3. **记进调用方 pass、回放得很晚的 draw，参数必须每帧恒定**（或与 draw 一一对应）：
   uniform 是记录时写、回放时读的，共享 pass 实例 + 每 draw 换参数 = 全部用到最后一次的值
   （阴影串色就是这么来的）。参数会变的，就当场 `submit` 掉，或者按参数建实例并缓存。

## 8. 新增一个示例

1. 新建 `examples/<名字>/main.ts` + `index.html`（`<script type="module" src="./app.js">`）；
2. 在 `tools/build-examples.mjs` 的 `demos` 列表里加一行（标题 + 名字）；
3. 3D 示例建议 `bootDemo({...})`（自带后端切换 `?backend=`、FPS、轨道相机）；
   完整应用建议直接用 `App`（`examples/app`）；
4. 建议带一个自检：`?selftest=1` 时在控制台打印 `XXX_SELFTEST {...}` 结构化结果，
   便于用 `tools/browser-probe.mjs` 做无头双后端回归：

   ```bash
   npm run build:examples && npm run serve &
   EXTRA_CHROME_FLAGS=--enable-unsafe-swiftshader \
     node tools/browser-probe.mjs "http://127.0.0.1:8095/<名字>/index.html?backend=webgpu" tag
   ```
