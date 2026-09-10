# 离屏渲染与后处理（RenderTarget · MSAA · EffectComposer）

> 相关源码：`src/render/RenderTarget.ts`、`src/render/postfx/`
> 示例：`examples/postfx`（键位 **B** 泛光 · **T** 色调映射 · **V** 暗角 · **M** MSAA · **P** 整链开关）

---

## 1. RenderTarget：一等公民的离屏目标

`RenderTarget` 把「颜色附件 + 深度附件 + （可选）MSAA 解析目标」打包好，并隐藏三后端差异：

```ts
const target = new RenderTarget(device, {
  width: 1280,
  height: 720,
  format: "rgba8unorm",   // 默认 rgba8unorm，HDR 可用 rgba16float
  depth: true,            // 默认 true；也可传 "depth24plus"
  sampleCount: 4,         // 默认 1；超过 device.limits.maxSamples 自动降级
  sampleable: true,       // 默认 true（后处理要采样它）
});

const pass = encoder.beginRenderPass({
  colorAttachments: [target.colorAttachment({ clearValue: { r: 0, g: 0, b: 0, a: 1 } })],
  depthStencilAttachment: target.depthAttachment(),
});
// …绘制…
pass.end();

const pixels = await target.readPixels();   // 左上原点、紧凑 RGBA（三后端统一）
target.resize(w, h);                        // 重建附件（尺寸没变返回 false）
target.dispose();
```

关键语义：

| 成员 | 含义 |
| --- | --- |
| `texture` | **解析后**的可采样结果（MSAA 时也是它） |
| `depth` | 深度纹理（未开深度为 `null`） |
| `colorView()` / `depthView()` | 渲染用附件视图（MSAA 时是多采样纹理） |
| `resolveView()` | MSAA 解析目标视图；非 MSAA 为 `null` |
| `sampleCount` | 实际生效的采样数（已按 `device.limits.maxSamples` 降级） |

`colorAttachment()` 会自动带上 `resolveTo` 与 `sampleCount`，`depthAttachment()` 同理，
所以**使用方不需要知道后端怎么做 MSAA**。

## 2. MSAA 在三后端的实现

| 后端 | 做法 |
| --- | --- |
| WebGPU | 多采样纹理作为附件 + `resolveTarget` 解析到 `texture`；管线 `multisample.count` 必须与附件一致 |
| WebGL2 | 多重采样 renderbuffer（`renderbufferStorageMultisample`）+ `endRenderPass` 时 `blitFramebuffer` 解析 |
| Mock | 只记录采样数，不做解析（无头测试用 `sampleCount` 断言） |

两条必须遵守的规则（框架已自动处理，扩展时注意）：

1. **多采样纹理不能被采样**：能采样的永远是 `texture`（解析结果），
   因此后处理链读的一定是 `target.texture`；
2. **WebGPU 管线采样数必须匹配附件**：材质与后处理效果都按「当前 pass 的采样数」
   自动缓存/选择管线（`RenderPassEncoder.sampleCount` →
   `BaseMaterial` 按采样数缓存管线），使用方无需手动重建管线。

> WebGL2 上 MSAA 的开销来自「renderbuffer + 每帧 blit 解析」，移动端建议
> `sampleCount: 2` 或仅在离屏链路上开、最终呈现不开。

## 3. EffectComposer：后处理链

```ts
const composer = new EffectComposer(device, {
  width: canvas.width,
  height: canvas.height,
  format: "rgba8unorm",   // 链路内部格式
  sampleCount: 4,         // 场景目标 MSAA（自动 resolve）
});

composer.addPass(new BloomPass(device, { threshold: 0.65, strength: 1.1 }));
composer.addPass(new ToneMapPass(device, { mode: "aces", exposure: 1.15 }));
composer.addPass(new VignettePass(device, { strength: 0.45 }));

// 每帧：
composer.render((pass) => sceneRenderer.render(pass, scene, camera));
// 画布 resize 后：
composer.resize(canvas.width, canvas.height);
// 运行时切 MSAA：
composer.setSampleCount(4);
// 测试/截图：渲染到内部目标并回读
const pixels = await composer.renderToPixels((pass) => sceneRenderer.render(pass, scene, camera));
```

数据流：

```
场景 → sceneTarget（可选 MSAA，自动 resolve）
     → 效果 1 → 内部目标 A
     → 效果 2 → 内部目标 B
     → …
     → 呈现（按输出格式的拷贝 pass）→ 画布 / 外部 RenderTarget
```

### 3.1 为什么最后还要一趟「呈现」拷贝

效果管线是按**链路格式**（`format`）创建的，而画布格式在 WebGPU 上通常是
`bgra8unorm`、WebGL2 上是 `rgba8unorm`。WebGPU 要求管线与附件的颜色格式一致，
所以链路永远写内部目标，最后由一趟**按输出格式创建**的 `CopyPass` 呈现到画布
（或 `render(renderScene, output)` 传入的外部目标）。这样：

- 链路格式可以随便换（HDR `rgba16float` 也一样）；
- 画布格式不同的后端不会管线不匹配；
- 传外部 `RenderTarget` 时效果仍然写内部目标，语义一致（结果可在 GPU 上继续用）。

### 3.2 效果契约：自己开 pass

```ts
export interface PostEffect {
  readonly name: string;
  readonly inputCount?: number;          // 默认 1
  render(ctx: PostEffectContext): void;
  resize?(width: number, height: number): void;
  dispose?(): void;
}
```

`PostEffectContext` 提供：

| 成员 | 用途 |
| --- | --- |
| `inputs` | `[0]` = 上一步结果纹理 |
| `output` | 本效果输出目标（`null` 表示画布） |
| `beginOutputPass(label)` | **由效果自己调用**开一个写向 `output` 的 pass，并负责 `end()` |
| `encoder` | 多趟效果自己开内部 pass（如 Bloom 的亮部/模糊） |
| `width` / `height` / `format` / `device` | 尺寸、链路格式、设备 |

> 规则：**不要嵌套 pass**。单趟效果用 `beginOutputPass()`；多趟效果（Bloom）
> 用 `ctx.encoder.beginRenderPass()` 先写自己的内部目标，最后再 `beginOutputPass()`
> 合成到输出。

### 3.3 内置效果

| 效果 | 关键参数 | 说明 |
| --- | --- | --- |
| `CopyPass` | — | 直通拷贝（也用于按输出格式呈现） |
| `ToneMapPass` | `mode`: `none`/`linear`/`reinhard`/`aces`、`exposure` | HDR → LDR |
| `BloomPass` | `threshold`、`strength`、`radius`、`scale` | 亮部提取 + 可分离高斯模糊 + 叠加，自带半分辨率目标 |
| `VignettePass` | `strength`、`softness` | 暗角 |
| `GrayscalePass` | `amount` | 灰度（Rec.709 权重） |
| `ShaderPass` | `fragment.{glsl,wgsl}`、`extraTextureCount` | 自定义单趟效果 |

自定义效果最省事的写法是继承 `FullScreenPass`（只要一对 fragment 源码）：

```ts
import { FullScreenPass, POSTFX_COMMON_GLSL, POSTFX_COMMON_WGSL } from "unidraw";

const chroma = new FullScreenPass(device, {
  name: "chromatic",
  fragment: {
    glsl: `#version 300 es
precision highp float;
${POSTFX_COMMON_GLSL}
void main() {
  vec2 d = (v_uv - 0.5) * u_params.x;
  fragColor = vec4(
    texture(u_input, v_uv + d).r,
    texture(u_input, v_uv).g,
    texture(u_input, v_uv - d).b, 1.0);
}`,
    wgsl: `
${POSTFX_COMMON_WGSL}
@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  let d = (in.v_uv - vec2f(0.5)) * fx.u_params.x;
  return vec4f(
    textureSample(u_input, u_inputSampler, in.v_uv + d).r,
    textureSample(u_input, u_inputSampler, in.v_uv).g,
    textureSample(u_input, u_inputSampler, in.v_uv - d).b, 1.0);
}`,
  },
});
chroma.setParams(0.01, 0, 0, 0);   // → u_params
composer.addPass(chroma);
```

`FullScreenPass` 的统一 bind group（group 0）：

| binding | 内容 |
| --- | --- |
| 0 | `ParamsBlock` UBO：`u_texelSize`（尺寸, 1/尺寸）/ `u_params` / `u_params2` |
| 1 | 输入纹理 `u_input` |
| 2 | 采样器（linear + clamp-to-edge） |
| 3.. | 额外纹理 `u_extraN`（`extraTextureCount`） |

顶点阶段用 `vertex_index` 生成覆盖屏幕的大三角形（`draw(3)`，无需顶点缓冲），
因此每个效果只有一对 fragment 源码。

## 4. 与场景材质配合

- 场景材质必须把颜色附件格式设成链路格式，否则 WebGPU 会报
  「Attachment state … is not compatible」：
  ```ts
  const material = new PhongMaterial(device, color, { targetFormat: "rgba8unorm" });
  ```
- 直接画到画布时不需要写 `targetFormat`（默认取画布格式）；
- 材质侧会按附件采样数自动选择匹配管线（MSAA 场景目标无需手动处理）。

## 5. 手写离屏 pass（不用 composer）

```ts
const target = new RenderTarget(device, { width, height, sampleCount: 4 });
const encoder = device.createCommandEncoder("offscreen");
const pass = encoder.beginRenderPass({
  colorAttachments: [target.colorAttachment()],
  depthStencilAttachment: target.depthAttachment(),
});
sceneRenderer.render(pass, scene, camera);
pass.end();
device.submit([encoder.finish()]);

// 结果可直接采样（自定义屏幕特效）或在下一帧画到画布
const pixels = await target.readPixels();
```

## 6. 自检与验证

`examples/postfx` 默认跑 `POSTFX_SELFTEST`：离屏渲染三种配置（泛光开/关、
ACES vs linear），打印亮部比例与平均亮度，并给出三个布尔结论：

```json
{"backend":"webgl2","msaa":4,"brightWithBloom":0.0193,"brightNoBloom":0.0187,
 "meanAces":0.0485,"meanLinear":0.049,"bloomOk":true,"tonemapOk":true,"contentOk":true}
```

- `bloomOk`：泛光让亮部比例变大（链路真的在起作用）；
- `tonemapOk`：两种色调映射产生可测量差异（该趟生效）；
- `contentOk`：三种配置都有内容（离屏渲染 / MSAA resolve 生效）。

同一份 JSON 可在 WebGL2 与 WebGPU 上对比（`?backend=webgl2|webgpu&msaa=1|4`）。
