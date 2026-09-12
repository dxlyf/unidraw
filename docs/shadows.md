# 阴影（Shadow Map）

> 相关源码：`src/render/shadow/`
> 示例：`examples/shadows`（键位 **S** 阴影 · **L** 灯光 · **R** 转太阳 · **1/2** 贴图 1024/2048）

支持 **方向光** 与 **聚光** 的阴影贴图（Shadow Map）：每个投影灯一张深度贴图，
受光材质在片元里做 PCF 软阴影（`filter` 可选 hard / 3×3 / 5×5）。WebGL2 与 WebGPU
的结果**逐像素基本一致**（示例自检的数值可跨后端直接对比）。

---

## 1. 最小用法

```ts
import { Scene, SceneRenderer, DirectionalLight, ShadowRenderer, Vec3 } from "unidraw";

const sun = new DirectionalLight(new Vec3(-0.5, -1, -0.4), "#fff3d6", 1.0);
sun.castShadow = true;              // 打开阴影（等价 three.js 的 castShadow）
sun.shadow.mapSize = 2048;          // 可选：贴图分辨率
scene.add(sun);

const shadows = new ShadowRenderer(device);

// 每帧（必须在主 pass **之前**提交）
shadows.renderAndSubmit(scene, camera, sceneRenderer);
const pass = renderer.beginFrame();
sceneRenderer.render(pass, scene, camera);
renderer.endFrame();
```

用 `App` 时更简单：

```ts
const app = await App.create(canvas, { shadows: true, shadowMapSize: 2048 });
app.scene.add(sun);   // sun.castShadow = true
app.start();
```

> **为什么必须分两次 submit**：WebGPU 不允许「同一个 submit 内某张纹理既作为附件写入、
> 又作为只读纹理资源绑定」。`renderAndSubmit()` 自动满足；若你想把阴影 pass 记录进
> 同一个 encoder（`render(encoder, ...)`，WebGL2 可以），请自行保证主 pass 在**另一次**
> submit 里。

## 2. 参数（`light.shadow`）

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 与 `light.castShadow` 相与；临时关闭用 `light.castShadow = false` |
| `mapSize` | `1024` | 贴图边长（clamp 到 64..4096）；越大越清晰、越费显存 |
| `bias` | `0.04` | 深度偏移（**世界单位**）；太小 → 自阴影条纹，太大 → 影子脱离物体 |
| `normalBias` | `0`（自动） | 沿法线的世界单位偏移；`0` = 自动取 **1.5 × 纹素**（斜面/薄片最有效） |
| `radius` | `2` | PCF 采样半径（纹素）：0 = 硬阴影，越大越软 |
| `filter` | `"pcf3"` | 滤波方式：`"hard"`（1 次比较）/ `"pcf3"` / `"pcf5"` |
| `intensity` | `1` | 阴影强度 0..1（0 = 看不出阴影，1 = 全黑） |
| `side` | `"back"` | 渲染进阴影图的面：`"back"`（默认，抗自阴影）/ `"front"`（单面几何）/ `"double"` |
| `near` / `far` | `0`（自动） | 阴影相机深度范围；聚光缺省 `near=0.1`、`far=distance`（或 60） |
| `areaSize` | `0`（自动） | **方向光**专用：正交半宽（世界单位）；手动指定可彻底稳定范围与质量 |
| `distance` | `1.5` | **方向光**专用：阴影相机到场景中心的距离倍数（仅自动拟合时生效） |
| `stabilize` | `true` | **方向光**专用：稳定化自动拟合（见下） |

> **`bias` 是「世界单位」**（不是归一化深度）。这样同一组参数在不同尺度的场景里表现一致：
> 早期版本用归一化深度，场景越大有效偏移越小，叠在一起的薄物体就闪（acne）。
> 经验值：约 **0.5~1.5 个阴影纹素**（纹素世界尺寸 = `2 × 拟合半径 / mapSize`，可在
> `shadows.stats.texelWorld` 里读到）。

### 2.1 方向光自动拟合与「稳定化」（消除闪烁）

方向光默认按**主相机可见物体**的包围球自动拟合正交阴影盒。如果每帧直接套用这个包围球，
相机/物体一微动，包围球半径与中心就跟着变 → 阴影贴图的**采样网格每帧漂移** → 影子
看起来一直在"闪"。`stabilize: true`（默认）做了三件事：

1. **平滑**：半径变大立刻跟随（不漏阴影），变小按时间常数收敛（`ShadowRenderer` 的
   `stabilizeTau`，默认 0.3s）；
2. **纹素尺寸量化**：把「纹素世界尺寸」量化到 1-2-5 阶梯（0.02 / 0.05 / 0.1 …），
   于是采样网格密度在绝大部分时间保持不变；
3. **中心量化**：拟合中心对齐到 1/16 半径的网格，配合 `fitDirectional` 里对光源位置的
   纹素对齐 —— 轻推相机时阴影贴图纹丝不动。

三个手段都可用 `examples/shadows` 的自检直接量化验证（`mapJitter = 0` 表示相机微动时
阴影贴图本身完全不变）。

想要**绝对稳定**：给方向光设 `areaSize`（固定正交半宽，例如游戏里的 `20`），
阴影盒就完全不会随可见物体变化了。

## 3. 一次能投影几盏灯

`MAX_SHADOW_MAPS = 4`（`src/render/shadow/constants.ts`）：一次着色最多 4 张贴图。
超出的投影灯会被跳过并记到 `shadows.stats.skipped`。上限同时决定：

- `ShadowBlock`（binding 6）里矩阵/参数的数组长度；
- 材质布局里声明的阴影贴图（binding 7..10）与采样器（binding 11..14）。

> 点光阴影（cube map）**暂不支持**：需要在 6 个面上各跑一趟深度 pass。
> 底层能力（分层渲染附件 + 分层深度回读）已经就绪 ——
> `new RenderTarget(device, { dimension: "2d-array", depthOrArrayLayers: 6, depth: "depth32float" })`
> 配合 `depthAttachment({ layer: f })` 就能逐面写深度，见 [postfx.md](postfx.md)「分层渲染目标」；
> 剩下的是每帧遍历 6 个方向 + 在材质里按方向采样（PCF/球谐可复用现有方向光代码）。

## 4. 实现要点（扩展/排查时看这里）

### 4.1 深度贴图 + 手动 PCF（不是比较采样器）

阴影贴图是一张 `depth32float` 深度纹理，深度 pass 用**只写深度**的管线绘制：

```ts
const pass = encoder.beginRenderPass({
  colorAttachments: [],                              // 无颜色附件（WebGL2 走 drawBuffers(NONE)）
  depthStencilAttachment: map.depthAttachment(),     // loadOp: "clear", clearValue: 1
});
```

着色器侧用 `texelFetch`（GLSL）/ `textureLoad`（WGSL）读原始深度并**自己比较**：

- 不需要「比较采样器」（WebGL2 没有这个概念）、不需要任何扩展；
- 两个后端的比较语义完全一致；
- PCF 在片元里按 `filter` 做 1 / 3×3 / 5×5 次比较（`shadow.radius` 缩放采样偏移）。

两个后端唯一的差异是**深度范围约定**：WebGL2 的窗口深度 = `(z_ndc + 1) / 2`，
WebGPU 直接存 `z_ndc`；GLSL/WGSL 各写一份，换算见 `shadowShaders.ts`。

### 4.2 每张贴图一个深度材质

深度材质的「光源视投影矩阵」写在**相机 UBO** 里，而 UBO 是立即写入的。
如果多张贴图共用一个材质，同一个 submit 内后一张的矩阵会覆盖前一张
（表现为「第一张阴影贴图里装的是最后一张的内容」）。因此 `ShadowRenderer` 为
每张贴图懒惰创建一个 `ShadowDepthMaterial`（各自的相机 UBO）。

### 4.3 深度 pass 用反向剔除

`ShadowDepthMaterial` 默认 `cullMode: "front"`（`side:"back"`：剔除面向光源的正面，
只渲染背向光源的面）：物体正对光源的面不写深度，比较时不会被自己的正面挡住，
能显著减少自阴影条纹。`shadow.side` 可选 `"front"`（只渲染正对光源的面，适合单面几何）
或 `"double"`（不剔除，适合薄片/双面材质，但自阴影风险最高）。
它是 `depthOnly: true` + `receiveShadows: false`：管线没有颜色附件，
bind group 也不绑定阴影贴图（否则 WebGPU 会报读写冲突）。

### 4.4 材质如何拿到阴影数据

`defaultGroupEntries()` 在标准布局里固定声明（4/5 留给具体材质的纹理）：

| binding | 内容 |
| --- | --- |
| 6 | `ShadowBlock`：`u_shadowMatrix[4]` / `u_shadowParams[4]` / `u_shadowParams2[4]` / `u_shadowMeta` |
| 7..10 | 4 张阴影贴图（`texture_depth_2d`，`sampleType: "depth"`） |
| 11..14 | 4 个 NEAREST 采样器（WebGL2 按顺序与纹理配对） |

`u_shadowParams[m]` = `(bias, 1/mapSize, 类型, 光源序号)`，`u_shadowParams2[m]` =
`(PCF 半径, 法线偏移, filter 编码, intensity)`；着色器按「类型（0 方向光 / 1 聚光）+
该类型内的序号」匹配到灯：编号顺序与 `collectLights()` 的打包顺序一致
（见 `lights/collectLightNodes.ts`）。`bias`/`normalBias` 在打包时已换算成
归一化深度（`bias / depthRange`，GLSL 额外 ×0.5 以适配窗口深度约定）。

没有阴影时 `u_shadowMeta.x = 0`，着色器立即返回「完全受光」，几乎没有开销。
`render/shadow/ShadowResources.ts` 里的 UBO / 贴图池 / 占位纹理是**全设备共享**的，
因此材质数量多也不会重复占用纹理单元。

## 5. 自检与调试

`examples/shadows` 的 `SHADOW_SELFTEST` 打印（质量指标）：

```json
{"backend":"webgpu","shadowedRatioA":0.029,"shadowedRatioB":0.0333,"brighterRatio":0,
 "meanOn":0.5719,"meanOff":0.5803,"movedAway":0.0141,"movedIn":0.0184,"drawn":28,
 "acneRatio":0,"jitterRatio":0.0037,"mapJitter":0,
 "texelWorld":0.02,"biasDepth":0.000814,"normalBias":0,"normalBiasAuto":0.03,
 "shadowOk":true,"moveOk":true,"exposureOk":true,"acneOk":true,"mapJitterOk":true,"jitterOk":true}
```

- `shadowedRatioA/B`：两个太阳方向下「相对各自无阴影基准变暗」的像素比例（> 1% 才算有阴影）；
- `brighterRatio`：阴影让像素**变亮**的比例（应接近 0，说明不是整屏压暗）；
- `movedAway` / `movedIn`：换光照方向后有阴影 ↔ 无阴影的像素比例（证明阴影跟着光走）；
- `exposureOk`：整体亮度变化 < 25%（阴影不该改变整体曝光）；
- `acneRatio`：孤立浮空测试盒上「应受光却变暗」的像素比例（自阴影条纹，应接近 0）；
- `mapJitter`：相机微动前后阴影贴图本身的差异比例（0 = 纹素网格完全稳定）；
- `jitterRatio`：相机微动前后画面里阴影掩码翻动的比例（越小越稳）；
- `texelWorld` / `biasDepth` / `normalBias` / `normalBiasAuto`：当前纹素世界尺寸、换算后的
  bias、显式 normalBias 与自动值，用于判断参数是否落在合理区间。

`?debug=1` 会把第 0 张阴影贴图的深度可视化成 ASCII 网格（无头环境下排查
「贴图里到底有没有东西」非常有效）。

## 6. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 完全没有阴影 | 没调 `shadows.renderAndSubmit()` / App 没开 `shadows`；灯没设 `castShadow` |
| 表面全是条纹（acne） | 先试 `normalBias: 0`（自动 = 1.5×纹素）；还不行就增大 `bias`（世界单位，0.04 → 0.06~0.08），或薄片/双面几何把 `side` 改成 `"front"`/`"double"`，或增大 `mapSize` 缩小纹素 |
| 影子与物体分离 | `bias` 太大（世界单位，降到 0.02~0.04）；或场景尺度很大时用 `areaSize` 收窄正交范围 |
| 影子一直在「闪」（方向光） | `stabilize: true`（默认）已做平滑 + 纹素尺寸 1-2-5 阶梯量化 + 中心对齐；要绝对稳定就固定 `areaSize`（如游戏里设 20） |
| 影子边缘锯齿/太硬 | 提高 `mapSize`；增大 `radius`（如 3）或 `filter: "pcf5"`；想要硬阴影用 `filter: "hard"` |
| 影子太黑/太淡 | 调 `intensity`（0..1；0.3 左右是常用软影效果） |
| 大片区域没有影子 | 物体在光源视锥/深度范围外（`distance`/`far` 太小，或超出 `MAX_SHADOW_MAPS`） |
| WebGPU 报「读写同一张纹理」 | 阴影 pass 和主 pass 必须在**不同 submit**（用 `renderAndSubmit()`） |
| 桌面端有阴影、WebGL2 没有 | 检查是否用了 `depth24plus` 之类的不可采样格式（固定用 `depth32float`） |
