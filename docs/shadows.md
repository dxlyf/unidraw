# 阴影（Shadow Map）

> 相关源码：`src/render/shadow/`
> 示例：`examples/shadows`（键位 **S** 阴影 · **L** 灯光 · **R** 转太阳 · **1/2** 贴图 1024/2048）

支持 **方向光** 与 **聚光** 的阴影贴图（Shadow Map）：每个投影灯一张深度贴图，
受光材质在片元里做 3×3 PCF 软阴影。WebGL2 与 WebGPU 的结果**逐像素基本一致**
（示例自检的数值可跨后端直接对比）。

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
| `mapSize` | `1024` | 贴图边长（自动 clamp 到 64..4096）；越大越清晰、越费显存 |
| `bias` | `0.0018` | 深度偏移：太小 → 自阴影条纹（acne），太大 → 影子脱离物体（peter-panning） |
| `normalBias` | `0.03` | 沿法线的世界单位偏移（对斜面自阴影很有效） |
| `radius` | `1.5` | PCF 采样半径（纹素）：0 = 硬阴影（单次比较），越大越软 |
| `near` / `far` | `0`（自动） | 阴影相机深度范围；聚光缺省 `near=0.1`、`far=distance`（或 60） |
| `areaSize` | `0`（自动） | **方向光**专用：正交阴影半宽（世界单位）；手动指定可稳定范围与质量 |
| `distance` | `1.5` | **方向光**专用：阴影相机到场景中心的距离倍数（仅自动拟合时生效） |

方向光默认会**自动拟合**：用主相机可见物体的包围球求出中心与半径，
把正交相机放在 `中心 - 光方向 × distance × 半径` 处，并按纹素在光的右/上轴上取整
（texel snapping）以减少相机移动时的阴影边缘抖动。场景很大时可用 `areaSize` 手动收窄。

## 3. 一次能投影几盏灯

`MAX_SHADOW_MAPS = 4`（`src/render/shadow/constants.ts`）：一次着色最多 4 张贴图。
超出的投影灯会被跳过并记到 `shadows.stats.skipped`。上限同时决定：

- `ShadowBlock`（binding 6）里矩阵/参数的数组长度；
- 材质布局里声明的阴影贴图（binding 7..10）与采样器（binding 11..14）。

> 点光阴影（cube map）**暂不支持**：WebGL2 没有分层渲染，需要在 6 个面上各跑一趟，
> 目前先覆盖方向光/聚光这两个最常用的场景。

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
- PCF 在片元里做 3×3（`shadow.radius` 缩放偏移）。

两个后端唯一的差异是**深度范围约定**：WebGL2 的窗口深度 = `(z_ndc + 1) / 2`，
WebGPU 直接存 `z_ndc`；GLSL/WGSL 各写一份，换算见 `shadowShaders.ts`。

### 4.2 每张贴图一个深度材质

深度材质的「光源视投影矩阵」写在**相机 UBO** 里，而 UBO 是立即写入的。
如果多张贴图共用一个材质，同一个 submit 内后一张的矩阵会覆盖前一张
（表现为「第一张阴影贴图里装的是最后一张的内容」）。因此 `ShadowRenderer` 为
每张贴图懒惰创建一个 `ShadowDepthMaterial`（各自的相机 UBO）。

### 4.3 深度 pass 用正面剔除

`ShadowDepthMaterial` 默认 `cullMode: "front"`（只渲染背向光源的面）：
物体的正面不写深度，比较时不会被自己的正面挡住，能显著减少自阴影条纹。
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
`(PCF 半径, 法线偏移)`；着色器按「类型（0 方向光 / 1 聚光）+ 该类型内的序号」匹配到灯：
编号顺序与 `collectLights()` 的打包顺序一致（见 `lights/collectLightNodes.ts`）。

没有阴影时 `u_shadowMeta.x = 0`，着色器立即返回「完全受光」，几乎没有开销。
`render/shadow/ShadowResources.ts` 里的 UBO / 贴图池 / 占位纹理是**全设备共享**的，
因此材质数量多也不会重复占用纹理单元。

## 5. 自检与调试

`examples/shadows` 的 `SHADOW_SELFTEST` 打印：

```json
{"backend":"webgpu","shadowedRatioA":0.0222,"shadowedRatioB":0.0173,"brighterRatio":0,
 "meanOn":0.5749,"meanOff":0.5821,"movedAway":0.0111,"movedIn":0.0062,"drawn":20,
 "shadowOk":true,"moveOk":true,"exposureOk":true}
```

- `shadowedRatioA/B`：两个太阳方向下「相对各自无阴影基准变暗」的像素比例（> 1% 才算有阴影）；
- `brighterRatio`：阴影让像素**变亮**的比例（应接近 0，说明不是整屏压暗）；
- `movedAway` / `movedIn`：换光照方向后有阴影 ↔ 无阴影的像素比例（证明阴影跟着光走）；
- `exposureOk`：整体亮度变化 < 25%（阴影不该改变整体曝光）。

`?debug=1` 会把第 0 张阴影贴图的深度可视化成 ASCII 网格（无头环境下排查
「贴图里到底有没有东西」非常有效）。

## 6. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 完全没有阴影 | 没调 `shadows.renderAndSubmit()` / App 没开 `shadows`；灯没设 `castShadow` |
| 表面全是条纹（acne） | 增大 `shadow.bias`（0.002 → 0.005）或 `shadow.normalBias`；也可增大 `mapSize` |
| 影子与物体分离 | `bias` 太大；或场景尺度很大时用 `areaSize` 收窄正交范围 |
| 影子边缘锯齿/抖动 | 提高 `mapSize`；方向光自动拟合会跟随可见物体，必要时手动给 `areaSize` |
| 大片区域没有影子 | 物体在光源视锥/深度范围外（`distance`/`far` 太小，或超出 `MAX_SHADOW_MAPS`） |
| WebGPU 报「读写同一张纹理」 | 阴影 pass 和主 pass 必须在**不同 submit**（用 `renderAndSubmit()`） |
| 桌面端有阴影、WebGL2 没有 | 检查是否用了 `depth24plus` 之类的不可采样格式（固定用 `depth32float`） |
