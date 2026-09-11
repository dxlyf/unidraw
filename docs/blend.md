# 混合模式（blend）

> 相关源码：`src/render/blendModes.ts`、`src/render/BaseMaterial.ts`（`MaterialOptions.blend` / `depthWrite`）
> 示例：`examples/blend`（右上角 lil-gui 实时切换预设/因子/运算，`BLEND_SELFTEST` 跨后端对比）

## 1. 用法

```ts
import { PhongMaterial, BLEND_PRESETS, blendState, blendPreset } from "unidraw";

// 1) 预设
const glass = new PhongMaterial(device, color, {
  blend: blendPreset("additive").state,   // 叠加发光
  depthWrite: false,                      // 半透明通常不写深度
});

// 2) 自定义（与 WebGPU GPUBlendComponent 一一对应）
const custom = new ColorMaterial(device, color, {
  blend: blendState({ src: "src-alpha", dst: "one", op: "add" }, { src: "one", dst: "one" }),
});

// 3) 等价的老写法：标准 alpha 混合
const simple = new ColorMaterial(device, color, { alphaBlend: true });
```

`MaterialOptions`：

| 选项 | 说明 |
| --- | --- |
| `blend` | `BlendStateDescriptor`：`color` / `alpha` 各一份 `{ srcFactor, dstFactor, operation }` |
| `alphaBlend` | 简写：`{ src-alpha, one-minus-src-alpha }`（颜色）+ `{ one, one-minus-src-alpha }`（alpha） |
| `depthWrite` | 默认 `true`；半透明建议 `false`（仍参与深度测试，只是不写深度） |
| `depth` | `false` = 完全关闭深度状态（测试与写入都关） |
| `cullMode` | `"back"`（默认）/ `"front"` / `"none"`（半透明面片常用 `none`） |

`BLEND_PRESETS`（`id` / 中文 `label` / `state`）：

| id | 效果 |
| --- | --- |
| `normal` | 正常 alpha 混合（等价 `alphaBlend: true`） |
| `additive` | 叠加发光（`src-alpha` / `one`） |
| `multiply` | 正片叠底（`dst` / `zero`） |
| `screen` | 滤色（`one` / `one-minus-src`） |
| `premultiplied` | 预乘 alpha（`one` / `one-minus-src-alpha`） |
| `subtract` | `dst - src`（`reverse-subtract`） |
| `min` / `max` | 逐通道取较暗 / 较亮 |
| `replace` | 覆盖（不混合，`state` 为 `undefined`） |

## 2. 半透明排序与深度写入

带 `blend` 或 `alphaBlend` 的材质 `isTransparent === true`，`SceneRenderer` 会：

1. 先画**不透明**物体（近→远，利于 early-z）；
2. 再画**半透明**物体，按到相机的距离**远→近**（正确的叠加顺序）。

两个坑（示例 `examples/blend` 的自检专门覆盖）：

- **不写深度**（`depthWrite: false`）时半透明之间才不会被互相遮挡 —— 但这要求绘制
  顺序正确；关掉排序后近处先画，叠加结果就错了；
- **写深度**（默认）时，若顺序不对（例如没排序），先画的近处半透明会把后面所有层
  挡掉，画面看起来"少了几层"。

因此实践建议：**半透明材质 `depthWrite: false` + 保持 `SceneRenderer.sort = true`**。
需要手动控制顺序时用 `Mesh.renderOrder`（不同 `renderOrder` 优先于距离排序）。

## 3. 后端一致性

- `BlendStateDescriptor` 直接映射到 WebGPU 的 `GPUBlendComponent`；
- WebGL2 后端把它翻译成 `gl.blendFuncSeparate` + `gl.blendEquationSeparate`；
- 三种 factor/operation 在本框架的 `BlendFactor`/`BlendOperation` 里都有定义
  （`zero/one/src/one-minus-src/src-alpha/one-minus-src-alpha/dst/one-minus-dst/
  dst-alpha/one-minus-dst-alpha/src-alpha-saturated/constant/one-minus-constant`
  与 `add/subtract/reverse-subtract/min/max`）；
- 注意：`min`/`max` 这类运算在 WebGL2 上属于 GLES3 的核心功能（无需扩展），
  但在部分移动 GPU 上可能较慢。

## 4. 自检（`examples/blend`）

`BLEND_SELFTEST` 离屏渲染多种配置并比较像素，两个后端数值一致：

```json
{"backend":"webgpu","meanNormal":0.1612,"meanAdditive":0.2223,"meanMultiply":0.1272,
 "meanOpaque":0.1895,"meanUnsortedWritten":0.1678,
 "diffAdditive":0.1825,"diffUnsorted":0.0419,"diffDepthWrite":0.1325,
 "additiveOk":true,"multiplyOk":true,"blendChanged":true,
 "sortMatters":true,"depthWriteMatters":true,"opaqueDiffers":true}
```

- `additiveOk` / `multiplyOk`：叠加必须更亮、正片叠底必须更暗；
- `blendChanged`：换混合模式的画面必须变化；
- `sortMatters`：关掉排序后的画面必须变化（半透明顺序很重要）；
- `depthWriteMatters`：在没排序的前提下打开写深度，后面的层会被挡掉；
- `opaqueDiffers`：不混合（覆盖）与混合必须不同。
