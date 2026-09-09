# 架构与设计

本文说明 UniDraw 的整体分层与关键设计决策。

## 1. 分层

```
┌─────────────────────────────────────────────────────┐
│  render/   Geometry·primitives·material·texture·    │  易用层
│            Camera·Mesh·Renderer·UniformBlock        │  （内置材质=约定）
├─────────────────────────────────────────────────────┤
│  command/  ops·CommandEncoder·RenderPassEncoder·    │  统一命令层
│            CommandBuffer                            │  （与后端无关）
├─────────────────────────────────────────────────────┤
│  device/   Device 抽象 + 资源句柄 + descriptors      │  资源抽象层
├──────────────────┬────────────────┬─────────────────┤
│  backend/webgl2  │ backend/webgpu │ backend/mock    │  后端翻译层
│  同步 GL2 实现    │ WebGPU 实现      │ 无头 CPU 实现   │
└──────────────────┴────────────────┴─────────────────┘
```

### 数学库 `math/`
纯 TypeScript、零依赖。`Mat4` 为列主序（与着色器一致），方法就地修改并返回
`this` 以便链式：`Mat4.identity().translate(...).rotateY(...).scale(...)`。

### 统一类型 `gpu/types.ts`
枚举常量与字符串联合同时被三种后端消费，例如：

- `BufferUsage.VERTEX | INDEX | UNIFORM | ...`
- `VertexFormat: "float32x3" | "unorm8x4" | ...`（与 WebGPU 命名一致）
- `TextureFormat: "rgba8unorm" | "rgba8unorm-srgb" | "depth24plus" | ...`

`gpu/formats.ts` 维护到 GL 常量 / WebGPU 字符串的元信息；
`gpu/std140.ts` 是 UBO 布局的唯一事实来源（见下）。

## 2. 统一命令（核心抽象）

参考 WebGPU 的编程模型，全部命令与后端无关：

```ts
const encoder = device.createCommandEncoder();
const pass = encoder.beginRenderPass({
  colorAttachments: [{ view: null /* canvas */, loadOp: "clear", clearValue: ... }],
  depthStencilAttachment: { view: null, depthLoadOp: "clear", ... },
});
pass.setPipeline(pipeline);
pass.setBindGroup(0, group);
pass.setVertexBuffer(0, geo.vertexBuffer);
pass.setIndexBuffer(geo.indexBuffer, "uint16");
pass.drawIndexed(36, 6);       // indexCount, instanceCount
pass.end();
device.submit([encoder.finish()]);
```

- **Recording → Submit**：命令先记录为不可变 op 数组（`command/ops.ts`），
  `submit` 时由后端翻译。CommandBuffer 可重复提交（重放）。
- 后端行为一致性由 **MockDevice 单测**保证：同一段客户代码跑在三种后端，
  Mock 提供命令级状态机校验（格式匹配、绑定完整、越界检查）。

## 3. Uniform 全部走 UBO（高性能的关键之一）

- 内置材质没有逐字段 uniform 上传；所有常量都在 uniform buffer 里，
  由 `UniformBlock`（CPU 侧按 std140 打包）一次写入。
- `std140` 规则覆盖标量/向量/mat4/数组：
  - vec3 对齐 16、vec4/mat4 对齐 16、标量对齐 4；
  - 数组元素 stride = 元素大小向上取整到 16。
- 同一布局描述驱动三处：
  - GLSL `layout(std140) uniform BlockName { ... };`（块名 = layout entry name）
  - WGSL `struct`（uniform 地址空间的标准布局与其一致，字段均为 ≥16B 对齐类型）
  - CPU `UniformBlock` 打包 → `buffer.write`。
- 因而 **GL 后端无需按字段调用 uniform API**，只需在提交时 bind UBO binding point。

## 4. BindGroup 在两种后端的等价实现

### WebGPU（原生）
`BindGroupLayout → GPUBindGroupLayout`，`BindGroup → GPUBindGroup`，
binding 编号直接对应 WGSL `@group(g) @binding(b)`。

### WebGL2（翻译）
- 创建 `BindGroupLayout` 时即从设备级游标**分配固定**的 UBO binding point 与
  纹理单元（unit 0 保留给内部上传用）。
- 绑定资源 = `bindBufferBase(UNIFORM_BUFFER, point, buf)` / `activeTexture(unit)+bindTexture` /
  `bindSampler(unit, sampler)`。
- 纹理 entry 与 sampler entry 按**出现顺序配对**。
- pipeline 创建时对每个 uniform block 调用 `uniformBlockBinding(program, index, point)`；
  每个 texture entry 名的 sampler uniform 指向该 layout 分配的单元。
- 相同的 BindGroupLayout 在 GL 中映射一致 ⇒ 与 WebGPU 布局可复用语义对齐。

## 5. 顶点缓冲与 VAO

- 内置“标准布局”是单个交错缓冲：`position(0) + normal(12) + uv(24)`，stride 32。
- Pipeline 顶点状态可按需只声明用到的 attribute，但 stride/offset 必须匹配数据。
- WebGL2 后端按 `(pipeline, 顶点/索引缓冲快照, baseVertex)` 缓存 VAO，
  首次创建后每帧复用，避免重复 `vertexAttribPointer`。
- 实例化通过 `stepMode: "instance"` + 独立 slot 的缓冲 + `drawIndexed(count, N)`。

## 6. 深度测试跨后端

- WebGL2：canvas 上下文以 `depth:true` 创建，`view: null` 深度附件落在默认帧缓冲。
- WebGPU：`view: null` 深度附件由设备内部深度纹理实现（尺寸随画布自动重建，
  格式 `depth24plus`）。
- 离屏渲染：传入显式深度纹理（`device.createTexture({format:"depth24plus",
  usage:RENDER_ATTACHMENT})`）。

## 7. 纹理上传

CPU 像素路径统一：`rgba8unorm` 等格式的 `Uint8Array` 上传到两种后端：

- WebGL2：`texSubImage2D` + `UNPACK_ROW_LENGTH` 处理 padded rows。
- WebGPU：`queue.writeTexture`，`bytesPerRow` 自动对齐 256。
- DOM 图像源（Image/ImageBitmap/Canvas）由 `textureFromImageSource` 经 2D 画布
  采样为像素（同源限制与浏览器一致）。

## 8. 为什么要 Mock 后端

- 无浏览器/GPU（CI、SSR、编辑器）也能执行整条“记录→提交”链路；
- 在命令执行处做与 GPU 一致的校验（格式匹配等），提前暴露 API 误用；
- 记录 draw 快照（pipeline/groups/buffers/参数），供单元测试断言。

## 9. 已知边界（v0.1）

- 单色附件渲染为主；MRT 在 WebGL2 端仅部分支持；
- 纹理格式子集：`rgba8unorm(-srgb)/r8unorm/rg8unorm/r32float/rgba16float/
  rgba32float/depth24plus/depth32float`；无压缩纹理；
- 无计算管线、无 storage buffer、无 indirect draw（扩展点已预留命名）；
- WGSL/GLSL 需成对写作（参考着色器指南），未来可引入自动转译。

## 10. 未来优化方向

- 提交期避免“先记录再翻译”的双份开销（为三后端一致性而设计，可针对 WebGPU
  增加直接编码路径）；
- 纹理 unit/UBO point 的静态分配 → 空间换时间；量级大时可做动态打包。
