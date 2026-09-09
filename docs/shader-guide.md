# 着色器写作指南

WebGL2（GLSL ES 3.00）与 WebGPU（WGSL）语法不同，v0.1 采用
**“双源码成对写作 + 强约定”**，以最小成本保证一致性。

> 好处：无转译魔法、两端都可逐字检查；约定见下，普通材质只需复制内置模板改改。

## 1. Program 的形状

```ts
device.createProgram({
  glsl: { vertex, fragment }, // WebGL2
  wgsl: { code },             // WebGPU（入口点默认 vs_main / fs_main）
});
```

## 2. 内置约定（请保持一致）

### 顶点布局（标准布局，stride 32B）

| location | 变量 | 格式 | offset |
| --- | --- | --- | --- |
| 0 | `a_position` | `float32x3` | 0 |
| 1 | `a_normal` | `float32x3` | 12 |
| 2 | `a_uv` | `float32x2` | 24 |

示例（geometry/mesh 层会自动按此交错上传，材质只需声明用到的属性）。

### bind group 0 绑定（内置材质）

| binding | 内容 | GLSL | WGSL |
| --- | --- | --- | --- |
| 0 | UBO `CameraBlock` | `layout(std140) uniform CameraBlock { mat4 u_viewProj; vec4 u_cameraPos; };` | `struct CameraBlock{...} @group(0) @binding(0) var<uniform> camera` |
| 1 | UBO `ModelBlock` | `... uniform ModelBlock { mat4 u_model; };` | `@binding(1) var<uniform> model` |
| 2 | UBO `MaterialBlock` | `... uniform MaterialBlock { vec4 u_color; };` | `@binding(2) var<uniform> material` |
| 3 | 纹理 `u_albedo` | `uniform sampler2D u_albedo;` | `@binding(3) var u_albedo : texture_2d<f32>` |
| 4 | 采样器 | （GLSL 无独立对象） | `@binding(4) var u_s : sampler` |

要点：

- **GLSL uniform block 名必须等于 BindGroupLayout entry 的 `name`**，
  后端据此做 `uniformBlockBinding` 映射；
- **texture entry 的 `name` 必须等于 GLSL sampler2D 变量名**；
- WGSL 中 struct 字段、位置、大小需与 std140 匹配（避免把数组/标量塞进共享 UBO，
  数组仅推荐 vec4/mat4）。
- 所有 `var<uniform>` 只使用 `mat4x4f/vec4f/vec3f/vec2f/f32` 这类 16/8/4 对齐类型，
  与 std140 自动一致。

### 入口点与输入输出

- WGSL 必须导出 `@vertex fn vs_main` 与 `@fragment fn fs_main`
  （或用 `ProgramDescriptor.wgsl.vertexEntryPoint/fragmentEntryPoint` 覆盖）；
- 片元输出 `@location(0)` 对应 pipeline `targets[0]`；
- 顶点输出 `@builtin(position)`。

## 3. GLSL 必写头

```glsl
#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;   // location 与顶点布局一致
```

## 4. 一个最小的自定义材质模板

参照 `examples/instancing/main.ts`（含实例流），要点：

1. 定义 `glsl.vertex/fragment` 与 `wgsl.code`（内容成对）；
2. `BindGroupLayout` entries 给出 `binding/name/type/visibility`；
3. `createRenderPipeline` 声明 vertex buffers（按需声明 location/offset/stride）、
   `depthStencil`、`targets[].format`（用 `device.canvasFormat()` 或你的附件格式）；
4. 每次绘制前 `UniformBlock.setMat4("u_viewProj", ...)` + `flush()`。

## 5. 排查清单

- [ ] WGSL struct 字段与 GLSL block 成员顺序/类型一致（决定内存偏移一致）；
- [ ] binding 编号与 BindGroupLayout 一致；
- [ ] GLSL uniform block 名与 layout entry name 一致；
- [ ] 顶点 location 与 VertexState 中 attributes 一致；
- [ ] `targets[].format` 与 pass 附件一致；
- [ ] WebGL2 报编译错：浏览器控制台有 `GLSL 编译失败：<log>`；
- [ ] WebGPU 报错：开启 `?debug=1` 查看 uncaptured error。

## 6. 未来方向

- 代码生成前/后文（attribute in/out、struct 声明由布局自动生成），减少手写；
- WGSL↔GLSL 自动转译（可挂 naga 等，作为可插拔 pass）。
