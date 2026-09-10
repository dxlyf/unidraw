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
> `signedVolume()` 能同时抓住「面没放对位置」和「绕序朝内」两类错误。

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

## 4. 离屏渲染（render-to-texture）

底层能力已经具备，可直接组合：

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

## 7. 裁剪 / 进阶

- 数学、材质、示例均为独立模块，按需引入；`sideEffects:false` 便于 tree-shaking。
- 增加计算管线时，建议：
  - `gpu/types.ts` 已有 `ShaderStage.COMPUTE`；
  - 新增 `dispatch` op 与 `ComputePipeline`；
  - WebGL2 侧可映射到 `gl.dispatchCompute`（需 WebGL2 的 compute 扩展或提示降级）。

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
