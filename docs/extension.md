# 扩展指南

## 1. 新增一种材质

内置模板见 `src/render/material.ts`。最小步骤：

1. 成对编写 shader（`src/render/shaders.ts` 或直接写在业务文件），遵守
   [着色器指南](shader-guide.md) 的 bind group / 顶点约定；
2. `device.createProgram({ glsl, wgsl })`；
3. `device.createBindGroupLayout` + `device.createRenderPipeline`；
4. 建立 1..N 个 `UniformBlock`（std140），在 `beginFrame` / 每 draw 前 `flush()`；
5. 暴露 `draw(pass, mesh)` 之类的便捷方法（可选）。

> 用 UBO 而非 uniform1f 上传常量，以获得 WebGL2 后端的最优路径。

## 2. 新增一种几何体

在 `src/render/primitives.ts` 增加生成 `GeometryData` 的函数
（`positions` 必填、`normals/uvs/indices` 可选），然后：

```ts
const data = myShape(1, 2);
const geo = Geometry.create(device, data);
```

`Geometry` 会按标准布局交错上传；材质按需声明 attribute 子集。
若你的材质使用不同顶点格式，可脱离 `Geometry`，自行 `device.createBuffer` +
自定义 `VertexStateDescriptor`（参考 instancing 示例）。

## 3. 离屏渲染（render-to-texture）

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

## 4. 新增一个后端

实现 `src/device/Device.ts` 的抽象类即可（约 10 个 create* + `executeOps` + 3 个查询）：

1. `Device` 子类持有原生上下文（如 `WebGL2Device.gl` / `WebGPUDevice.gpu`）；
2. 在 `src/device/resources.ts` 的资源基类上派生原生包装
   （`Buffer/Texture/Sampler/Program/BindGroupLayout/BindGroup/RenderPipeline`），
   构造时 `device.register(this)` 纳入统一生命周期；
3. 在 `executeOps` 里逐条翻译统一命令；
4. 在 `createDevice.ts` 登记候选与降级顺序；
5. 用同一套 Node 单测（跑在 Mock 上）作为行为基准自测。

## 5. 命令层的可移植性

`command/ops.ts` 中每条命令只是普通 JSON 化的对象（引用句柄），因此：

- 可在 worker/主线程间传递（句柄换成 id 后即可序列化，便于远程渲染）；
- 可离线录制/回放（demo/自动截图/一致性测试）；
- 可做批处理与重放优化（同一 CommandBuffer 提交多次）。

## 6. 裁剪 / 进阶

- 数学、材质、示例均为独立模块，按需引入；`sideEffects:false` 便于 tree-shaking。
- 增加计算管线时，建议：
  - `gpu/types.ts` 已有 `ShaderStage.COMPUTE`；
  - 新增 `dispatch` op 与 `ComputePipeline`；
  - WebGL2 侧可映射到 `gl.dispatchCompute`（需 WebGL2 的 compute 扩展或提示降级）。
