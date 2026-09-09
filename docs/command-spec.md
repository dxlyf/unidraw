# 统一绘制命令规范

本文件描述 `device/command` 层的公开 API 契约。三种后端（WebGL2 / WebGPU /
Mock）必须遵守同一语义，差异仅体现在提交后的执行方式。

## 1. 命令结构

所有命令是不可变对象，只引用“句柄”（`Buffer/Texture/RenderPipeline/BindGroup`），
因此命令缓冲与后端无关：

```
beginRenderPass { colorAttachments[], depthStencilAttachment? }
  ├ setPipeline / setBindGroup(g, bg) / setVertexBuffer(slot,buf,offset)
  ├ setIndexBuffer(buf, format, offset) / setViewport / setScissorRect
  ├ draw / drawIndexed
  └ endRenderPass
pushDebugGroup / popDebugGroup
```

## 2. 句柄生命周期

| 句柄 | 创建 | 更新 | 销毁 |
| --- | --- | --- | --- |
| `Buffer` | `device.createBuffer` | `buffer.write(data, offset)`（bufferSubData/writeBuffer） | `buffer.destroy()` |
| `Texture` | `device.createTexture` | `texture.upload(data, {x,y,width,height,bytesPerRow,mipLevel})` | `texture.destroy()` |
| `Sampler` | `device.createSampler` | 不可变 | `destroy()` |
| `Program` | `device.createProgram({glsl?, wgsl?})` | 不可变 | `destroy()` |
| `RenderPipeline` | `device.createRenderPipeline` | 不可变 | `destroy()` |
| `BindGroupLayout/BindGroup` | `create*` | BindGroup 不可变（内容变化需重建） | `destroy()` |
| `CommandEncoder` | `device.createCommandEncoder()` | 只追加 | `finish()` 后失效 |

规则：

- 资源销毁是幂等的；重复销毁被忽略。
- 正在被绘制引用的资源不建议在提交前销毁（VAO/FBO 缓存可能残留句柄）。
- `device.destroy()` 会销毁该设备创建的所有资源。

## 3. RenderPass 语义

`beginRenderPass` 描述符：

```ts
{
  colorAttachments: (RenderPassColorAttachment | null)[]; // 允许数组，取第一个作为主附件
  depthStencilAttachment?: { view; depthLoadOp?; depthStoreOp?; depthClearValue? };
}
```

- `view: null` ⇒ 渲染到 canvas；颜色/深度格式由设备决定。
- `view: TextureView` ⇒ 离屏渲染到纹理（需要 `usage: RENDER_ATTACHMENT`）。
- 默认 `loadOp:"clear"`、`storeOp:"store"`；清屏值缺省 `(0,0,0,1)`。
- 清屏不受 scissor 影响（与 WebGPU 一致）。
- 渲染目标格式校验：pipeline `targets[i].format` 必须与附件格式一致（WebGPU 强校验；
  WebGL2/Mock 在命令层做等价断言，尽早报错）。

## 4. 绘制命令

```ts
draw(vertexCount, instanceCount=1, firstVertex=0, firstInstance=0)
drawIndexed(indexCount, instanceCount=1, firstIndex=0, baseVertex=0, firstInstance=0)
```

前置条件（违反即抛 `UnidrawError`）：

- 必须先 `setPipeline`；
- `drawIndexed` 前必须 `setIndexBuffer`（含 format）；
- 顶点缓冲必须覆盖 pipeline 声明的每个 slot（GL2/Mock 校验 size/stride）。

`baseVertex` 语义与 WebGPU 一致（顶点索引偏移）。WebGL2 后端通过把
`baseVertex × stride` 并入 VAO 属性指针实现（见 architecture.md）。

## 5. BindGroup

```ts
BindGroupLayout { entries: [{ binding, type, visibility, name? }] }
BindGroup        { layout, entries: [{ binding, resource }] }
```

- `type`: `"uniform-buffer" | "texture" | "sampler"`。
- `binding` 必须与 WGSL `@group(0) @binding(n)` 一致；GLSL 由 `name` 关联：
  - uniform-buffer → GLSL uniform block 名；
  - texture → GLSL `uniform sampler2D <name>`（纹理 entry 名）；
  - sampler → 按 entry 顺序与 texture 配对（见架构文档）。
- `visibility` 建议 `VERTEX|FRAGMENT`（常量 `ShaderStage`）。
- 创建 BindGroup 时校验 binding 存在、资源类型匹配。

## 6. Viewport / Scissor

- 默认：viewport = 附件全尺寸；scissor 关闭（= 全尺寸）。
- `setScissorRect` 后生效，直到 pass 结束重置；`setViewport` 可多次。
- WebGPU 语义：两者独立，坐标以附件像素计（原点左上）。

## 7. 提交与同步

```ts
device.submit(commandBuffers: CommandBuffer[]);
await device.onSubmittedWorkDone();
```

| 后端 | submit 行为 |
| --- | --- |
| WebGL2 | 同步执行（记录→提交即刻翻译执行） |
| WebGPU | 提交到 GPU 队列（异步执行） |
| Mock | CPU 状态机执行，累积 draw 快照供断言 |

## 8. 一致性测试

`src/__tests__/mock-device.test.ts` 断言了下列契约，任何后端实现都应以
“与 Mock 一致”为目标：

1. 完整场景：`beginRenderPass(clear) → setPipeline → setBindGroup →
   setVertexBuffer → setIndexBuffer → drawIndexed → submit`；
2. 错误路径：缺 pipeline、缺索引缓冲、未 end 就 finish、越界 binding；
3. 离屏颜色附件清屏结果可读回；
4. 高层材质（ColorMaterial + Camera + Mesh）在 Mock 上可绘制。
