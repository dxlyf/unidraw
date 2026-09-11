# 架构与设计

本文说明 UniDraw 的整体分层与关键设计决策。

## 1. 分层

```
┌──────────────────────────────────────────────────────────────┐
│  app/      App 门面 + Plugin 生命周期 + 内置插件               │  应用层
│            （OrbitControls / Highlight）                      │  （单循环 step）
├──────────────────────────────────────────────────────────────┤
│  scene/    Node3D·Scene·Mesh·SceneRenderer·Frustum            │  场景层
│  interaction/  InputManager·Ray·Raycaster                     │  （层级/剔除/拾取）
│  picking/  ColorPicker·IdMaterial（GPU 颜色拾取）              │
│  animation/ KeyframeTrack·AnimationClip·Mixer·Tween·Easing    │
├──────────────────────────────────────────────────────────────┤
│  render/   Geometry·primitives·material·texture·              │  易用层
│            Camera·Mesh·Renderer·UniformBlock·RenderTarget·    │  （内置材质=约定）
│            postfx/（EffectComposer + 内置效果）                │
│  render2d/ Canvas2D（路径/填充/文本/裁剪）                     │
├──────────────────────────────────────────────────────────────┤
│  command/  ops·CommandEncoder·RenderPassEncoder·              │  统一命令层
│            CommandBuffer                                      │  （与后端无关）
├──────────────────────────────────────────────────────────────┤
│  device/   Device 抽象 + 资源句柄 + descriptors + 回读         │  资源抽象层
├──────────────────┬────────────────┬──────────────────────────┤
│  backend/webgl2  │ backend/webgpu │ backend/mock             │  后端翻译层
│  同步 GL2 实现    │ WebGPU 实现      │ 无头 CPU 实现            │
└──────────────────┴────────────────┴──────────────────────────┘
```

> 约定：**一个文件一个类/一个职责**；模块入口用同名 barrel 保持导入路径稳定
> （`device/resources.ts`、`command/encoder.ts`、`render/{material,shaders,primitives,texture}.ts`、
> `render2d/{path,style,renderer2d}.ts`、`scene/index.ts`、`animation/index.ts`、`app/index.ts`）。

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

### 3.1 动态偏移环形 UBO（共享材质逐物体矩阵）

问题：WebGPU 的 `queue.writeBuffer` 是**队列操作**，总在同一个 `submit()` 的 render pass
**之前**执行。若多个物体共用一个材质的模型矩阵 UBO，那么这一帧所有 draw 都会读到
最后一次写入的矩阵（物体重叠/消失）。WebGL2/Mock 因为立即执行而看不出问题。

方案：把模型矩阵放进**动态偏移**的环形 UBO：

- `BindGroupLayoutEntryDescriptor.hasDynamicOffset`（WebGPU `hasDynamicOffset` /
  WebGL2 `bindBufferRange`）；
- `UniformBlock({ slots })` 把 buffer 切成若干**按 `minUniformBufferOffsetAlignment` 对齐**
  的槽（WebGL2 查询 `UNIFORM_BUFFER_OFFSET_ALIGNMENT`，WebGPU 取 adapter limits）；
- 一次绘制 = `setPipeline` + `setBindGroup(0, group, [slot * stride])` + draw；
- 正确性条件：**同一次提交内每个 draw 用不同槽**。游标在 `beginFrame()` 或检测到
  `device.submitCount` 变化（说明上一次提交已入队，之后的写入在其之后执行）时归零；
- 槽容量不足时按需翻倍扩容（旧 buffer 已被命令引用，保持存活直到 device 销毁）。

带来的好处：一个材质实例 + 一条管线 + 一个 bind group 就能画任意多个物体（状态最小化），
CPU 侧只有一次 64B 的 `writeBuffer`（`perf-drawcalls` 示例即压这条路径）。

### 3.2 提交前合批的 UBO 上传

逐 draw 写 64B 在 WebGPU 上等于「每帧 6000+ 次队列操作」，是 draw call 压力的主要瓶颈
（实测 6000 draws 只有 24fps、且 **WebGPU 比 WebGL2 更慢**）。框架的做法：

- `UniformBlock.flushSlot()` 只把数据写进 **CPU 暂存**并记录待上传区间；
- `Device.onBeforeSubmit()` 钩子在 `submit()` 真正把命令交给 GPU 之前，
  把每个材质的待上传区间**合并成一次 `buffer.write`**；
- 两种后端都满足「钩子里的写先于本帧的 draw 生效」：WebGL2 在 submit 时才翻译命令、
  WebGPU 的 `writeBuffer` 是队列操作且先于同批 `queue.submit` 的命令缓冲执行。

实测（无头 SwiftShader，同机同档位）：

| 档位 | 逐 draw 上传 | 提交前合批 |
| --- | --- | --- |
| 6000 draws (WebGPU) | 41.8 ms / 24 fps | 17.0 ms / **59 fps** |
| 20000 draws (WebGPU) | 160.6 ms / 6 fps | 24.3 ms / **41 fps** |
| 20000 draws (WebGL2) | — | 44.5 ms / 22 fps |

另外两处配套优化（都体现在 `perf-drawcalls`）：

- **渲染通道编码器去重**：同一 pass 内重复的 `setPipeline` / `setVertexBuffer` /
  `setIndexBuffer` 不再产生命令（20000 draws 时省掉约 60% 的命令对象，
  WebGL2 实测 74 ms → 44 ms）；
- **WebGL2 的 VAO 快路径**：连续绘制同一 pipeline/缓冲时跳过 VAO key 字符串构造与 Map 查询，
  并缓存当前绑定的 VAO（`gl.bindVertexArray` 只在变化时调用）。

### 3.3 资源内容缓存与零分配命令编码

- `createProgram` / `createRenderPipeline` 在 `Device` 层按**内容指纹**去重
  （着色器源码哈希 + 程序 id + 顶点布局 + 光栅/深度/目标/采样数）：
  同构材质（例如 25 个球各一个 `ColorMaterial`）只编译一次着色器、只建一条管线，
  WebGL2 的 `useProgram` 去重命中率也随之提高；`device.programsCreated` /
  `pipelinesCreated` 暴露实际创建数量（自检/面板用）；
- 逐 draw 的热路径不做分配：动态偏移**按值内联**进命令 op
  （`RenderPassEncoder.setBindGroup` 最多 `MAX_DYNAMIC_OFFSETS = 2` 个），
  材质侧复用同一个 `offsets` 数组，ID 材质的额外偏移也用固定数组。

### 3.4 实例化（InstancedMesh）

同一几何体 + 材质的 N 个实例压成**一次 draw**：实例矩阵放在
`stepMode: "instance"` 的顶点流（location 3..6，stride 64）上，
顶点着色器计算 `u_model × instanceMatrix × position`；
材质的顶点着色器是标准版本时 `BaseMaterial` 会自动换成实例化版本。
细节与性能建议见 [instancing.md](instancing.md)。

## 4. BindGroup 在两种后端的等价实现

### WebGPU（原生）
`BindGroupLayout → GPUBindGroupLayout`，`BindGroup → GPUBindGroup`，
binding 编号直接对应 WGSL `@group(g) @binding(b)`。
动态偏移 entry 用 `GPUBufferBinding{ offset, size }`，
`setBindGroup(index, group, dynamicOffsets)` 与统一命令一一对应。

### WebGL2（翻译）
- 创建 `BindGroupLayout` 时即从设备级游标**分配固定**的 UBO binding point 与
  纹理单元（unit 0 保留给内部上传用）。
- 绑定资源 = `bindBufferBase(UNIFORM_BUFFER, point, buf)`（动态偏移 entry 用
  `bindBufferRange(point, buf, base + dynamicOffset, size)`）/
  `activeTexture(unit)+bindTexture` / `bindSampler(unit, sampler)`。
- 纹理 entry 与 sampler entry 按**出现顺序配对**；
  动态偏移数组按 binding 编号升序消费（与 WebGPU 规则一致）。
- pipeline 创建时对每个 uniform block 调用 `uniformBlockBinding(program, index, point)`；
  每个 texture entry 名的 sampler uniform 指向该 layout 分配的单元。
- 同一 pass 内重复设置同一 pipeline 会被跳过（`useProgram` + 状态设置去重）。
- 相同的 BindGroupLayout 在 GL 中映射一致 ⇒ 与 WebGPU 布局可复用语义对齐。

## 5. 顶点缓冲与 VAO

- 内置“标准布局”是单个交错缓冲：`position(0) + normal(12) + uv(24)`，stride 32。
- Pipeline 顶点状态可按需只声明用到的 attribute，但 stride/offset 必须匹配数据。
- WebGL2 后端按 `(pipeline, 顶点/索引缓冲快照, baseVertex)` 缓存 VAO，
  首次创建后每帧复用，避免重复 `vertexAttribPointer`。
- 实例化通过 `stepMode: "instance"` + 独立 slot 的缓冲 + `drawIndexed(count, N)`。

### 5.1 内置几何的拓扑保证

闭合几何（box / sphere / cylinder / cone / torus / capsule）保证：

- **没有边界边**（每条边恰好被 2 个三角形共用）→ 任何角度都不应看到“洞”；
- **没有零面积三角形**（退化三角形既浪费 draw 又说明生成逻辑有问题）；
- **没有非流形边**（被 >2 个三角形共用的边 → 穿面/自交）；
- 有符号体积（散度定理）与解析值一致 → 同时校验**绕序朝外**。

极点（球/胶囊的南北极、圆锥顶点）是最容易出错的地方：极点整行顶点位置重合，
若照搬中间环带的四边形，极点侧会出现两个重合顶点 → 退化三角形 →
实际上没有覆盖极点区域。内置生成器改用「极点 + 相邻环两点」的扇形三角形
（`sphere.ts` 与 `lathe.ts` / `cylinder.ts` 都遵循这一约定）。

这些性质由 `src/__tests__/primitives.test.ts` 的 `topology()` 断言守住 ——
「球体上下极点有洞」正是被它复现并修复的。新增几何体请一并补上该断言。

## 6. 深度测试跨后端

- WebGL2：canvas 上下文以 `depth:true` 创建，`view: null` 深度附件落在默认帧缓冲。
- WebGPU：`view: null` 深度附件由设备内部深度纹理实现（尺寸随画布自动重建，
  格式 `depth24plus`）。
- 离屏渲染：传入显式深度纹理（`device.createTexture({format:"depth24plus",
  usage:RENDER_ATTACHMENT})`）。
- **`depthLoadOp: "clear"` 对「显式深度纹理」同样必须生效**：WebGL2 早期实现只清
  canvas 默认深度，显式深度纹理会残留上一次 pass 的深度 → 后面的物体被“幽灵深度”
  挡住（离屏渲染表现为物体缺失；ID 拾取表现为拾取到错误对象）。
  现在两端都严格按 `loadOp` 处理（`gl.clear(DEPTH_BUFFER_BIT)` 作用于当前绑定的 FBO）。
  回归页：`examples/_verify-sphere`（`npm run build:verify` 打包后无头跑）。

### 6.1 投影矩阵使用 ZO 约定（NDC z ∈ [0,1]）

- `Mat4.perspective()` 输出 **ZO**（zero-to-one）投影：近平面 → `z=0`，远平面 → `z=1`，
  这是 WebGPU 的裁剪空间约定；
- `Mat4.perspectiveGL()` 保留 OpenGL 的 `z ∈ [-1,1]`（仅在需要与 GL 旧代码/工具对接时使用）；
- 为什么统一用 ZO：若给 WebGPU 传 GL 风格的投影，深度值会落在 `[-1,1]`，
  被裁剪到 `[0,1]` 后**损失一半精度**，并且近平面之前的几何不再被裁掉 —— 表现为
  深度冲突/穿透。反过来 ZO 投影在 WebGL2 上完全合法（`z<0` 的部分本来就位于近平面之前）；
- `Frustum.setFromProjectionMatrix(m, zZeroToOne = true)` 与投影约定配套
  （`zZeroToOne=false` 时按 GL 方式提取近平面），因此视锥剔除与深度测试一致；
- 单元测试覆盖两种约定：`mat4 perspective maps near/far planes (ZO)` 与
  `mat4 perspectiveGL 保留 GL 约定`。

### 6.2 `ELEMENT_ARRAY_BUFFER` 绑定属于 VAO 状态（写索引缓冲必须避开当前 VAO）

WebGL2 里「索引缓冲区」不是全局绑定，而是**每个 VAO 各存一份**：

```ts
gl.bindVertexArray(vao);                  // 之后的 ELEMENT_ARRAY_BUFFER 绑定写进 vao
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);// ← 改的是 vao 的索引绑定，不是全局状态
```

而框架的 VAO 是**缓存复用**的（`WebGL2Device._vaos`，每个「管线 + 顶点流 + 索引缓冲 +
baseVertex」组合创建一次，之后只 `bindVertexArray`）。于是下面这种写法会互相踩：

```ts
flatIBuf.write(flatIndices);   // 内部 bindBuffer(ELEMENT_ARRAY_BUFFER, flatIBuf)
textIBuf.write(textIndices);   // ← 把**当前 VAO**（flat 的 VAO）的索引绑定改成了 textIBuf
```

后果：flat 的 VAO 指向了 text 的索引缓冲区，后续 `drawElements` 读到**越界索引**
（越界读取返回 0）→ 三角形退化成零面积 → **整批绘制凭空消失**（不是画错位置，是完全不可见）。

- 触发条件很常见：同一帧里存在**两套顶点/索引缓冲**（典型是 `Canvas2D` 的
  「彩色图形 flat」+「文本 glyph」）。`flush()` 先写 flat 再写 text，于是**所有彩色图形
  在 WebGL2 上全部消失**，只剩文字可见（`examples/shapes2d` 的“只渲染了一部分”）；
- WebGPU 没有 VAO，`queue.writeBuffer` 不改变任何绑定状态 —— 所以这是**只在 WebGL2
  出现的后端差异**，单元测试（Mock 后端）也覆盖不到；
- 修法：`GLBuffer` 在写 `ELEMENT_ARRAY_BUFFER` 前把 VAO 解绑到默认 VAO（0），写完恢复
  原来的 VAO（`elementBindingSafe`）。默认 VAO 框架从不用于绘制，因此不会破坏缓存；
  构造函数里的 `bufferData` 同样要走这条路径。

回归页：`examples/_verify-2d-clip`（`npm run build:verify` 打包后无头跑，两个后端应
**逐像素完全一致**）。

> 顺带一提：`antialias` 在两端**不对称** —— WebGL2 的 canvas 上下文以
> `antialias: true` 创建，WebGPU 的 canvas 默认没有 MSAA。因此细线段（如 1.5px 描边）
> 的边缘覆盖率会有亚像素差异（表现为边缘 1~2 个像素的亮度不同），这是平台差异，
> 不是内容缺失。做逐像素对比时请挑**粗几何/填充**区域，或给 WebGL2 传
> `antialias: false`。

## 7. 纹理上传

CPU 像素路径统一：`rgba8unorm` 等格式的 `Uint8Array` 上传到两种后端：

- WebGL2：`texSubImage2D` + `UNPACK_ROW_LENGTH` 处理 padded rows。
- WebGPU：`queue.writeTexture`，`bytesPerRow` 自动对齐 256。
- DOM 图像源（Image/ImageBitmap/Canvas）由 `textureFromImageSource` 经 2D 画布
  采样为像素（同源限制与浏览器一致）。

## 8. 纹理回读与 GPU 颜色拾取

- `device.readTexturePixels(texture, rect)` 统一三后端，输出左上原点、紧凑 8bit RGBA：
  - WebGL2：临时 FBO + `readPixels` + 行翻转；
  - WebGPU：`copyTextureToBuffer`（行按 256B 对齐）+ `mapAsync` + 重排；
  - Mock：直接读 CPU 像素。
- `ColorPicker` 用它实现 GPU 拾取：`IdMaterial` 把物体编号编码成颜色画到离屏
  `rgba8unorm` 纹理（带深度），回读目标像素即得物体。
  ID 本身也走「动态偏移环形 UBO」（binding 3），所以**一个材质实例**就能给全部物体
  写各自的 ID；`collectVisible()` 复用主渲染的剔除/排序结果，保证「看到的」与
  「拾取到的」一致。
- 细节见 [picking.md](picking.md)。

## 9. 离屏渲染、MSAA 与后处理

- `RenderTarget`（`render/RenderTarget.ts`）把颜色 + 深度 + 可选 MSAA 解析目标打包，
  三后端行为一致：`texture` 永远是**解析后可采样**的结果；
- MSAA 的翻译方式：
  - WebGPU：多采样纹理 + `resolveTarget`（管线 `multisample.count` 必须与附件一致）；
  - WebGL2：多重采样 renderbuffer + `endRenderPass` 时 `blitFramebuffer` 解析；
  - Mock：只记录采样数（无头单测断言用）。
- 管线按采样数缓存：`RenderPassEncoder.sampleCount` → 材质/效果选择匹配管线，
  使用方切 MSAA 不需要重建材质（`setSampleCount()` 只换场景目标）；
- `EffectComposer` 的效果链写在**链路格式**的内部 ping-pong 目标上，最后用一趟
  **按输出格式**创建的 `CopyPass` 呈现到画布或外部 `RenderTarget`
  —— 这样 WebGPU 的 `bgra8unorm` 画布与 WebGL2 的 `rgba8unorm` 画布都能直接工作；
- 细节见 [postfx.md](postfx.md)。

## 10. 阴影（Shadow Map）

- 每个投影灯（方向光/聚光）一张 `depth32float` 贴图，深度 pass 用
  「无颜色附件 + 深度附件」的只写深度管线（WebGL2 走 `drawBuffers([NONE])`）；
- 光源视投影矩阵：方向光按可见物体包围球做正交拟合并在光空间右/上轴取整
  （texel snapping，减少抖动）；聚光用透视（视场角 = 外锥角 × 1.05）；
- 采样侧不依赖比较采样器：着色器用 `texelFetch` / `textureLoad` 读原始深度自己比较，
  3×3 PCF；两个后端的差异只有深度范围约定（WebGL2 窗口深度 = `(z_ndc+1)/2`，
  WebGPU 存 `z_ndc`），各写一份 shader 片段解决；
- 数据通道：`ShadowBlock`（binding 6）+ 4 张贴图（7..10）+ 4 个采样器（11..14）
  由 `defaultGroupEntries()` 固定声明，UBO/贴图池/占位纹理全设备共享；
- **一次 submit 内不能既写又读同一张纹理**：阴影 pass 必须与主 pass 分两次提交
  （`ShadowRenderer.renderAndSubmit()` / `AppOptions.shadows`），
  且深度材质不声明阴影贴图 binding（`receiveShadows: false`）；
- 细节见 [shadows.md](shadows.md)。

## 11. 为什么要 Mock 后端

- 无浏览器/GPU（CI、SSR、编辑器）也能执行整条“记录→提交”链路；
- 在命令执行处做与 GPU 一致的校验（格式匹配等），提前暴露 API 误用；
- 记录 draw 快照（pipeline/groups/buffers/参数），供单元测试断言。

## 12. 已知边界（v0.1）

- 单色附件渲染为主；MRT 在 WebGL2 端仅部分支持；
- 纹理格式子集：`rgba8unorm(-srgb)/r8unorm/rg8unorm/r32float/rgba16float/
  rgba32float/depth24plus/depth32float`；无压缩纹理；
- 回读仅支持 8bit 颜色纹理（`rgba8unorm/bgra8unorm` 系列）；
- 阴影只覆盖方向光/聚光（点光 cube map 未实现）；无计算管线、无 storage buffer、无 indirect draw；
- WebGL2 侧 `maxAnisotropy` 与 WebGPU 侧 `generateMipmaps()` 尚未接到底层 API；
- WGSL/GLSL 需成对写作（参考着色器指南），未来可引入自动转译。

## 13. 未来优化方向

- 提交期避免“先记录再翻译”的双份开销（为三后端一致性而设计，可针对 WebGPU
  增加直接编码路径）；
- 纹理 unit/UBO point 的静态分配 → 空间换时间；量级大时可做动态打包；
- 拾取：为静态场景缓存 ID pass（相机不动时不重绘），或做 ID 目标的小分辨率降级渲染。
