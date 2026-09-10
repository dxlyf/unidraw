# UniDraw

> 一套**统一绘制命令**的 TypeScript 图形框架：同一份源码、同一个命令 API，
> 同时运行在 **WebGL2** 与 **WebGPU** 之上。
>
> 高性能（UBO 驱动 / VAO 缓存 / 命令批提交）· 易用（几何体 + 材质 + 相机）
> · 可扩展（三后端、统一命令可序列化、新增后端只需实现 `Device`）。

---

## 特性一览

| 能力 | 说明 |
| --- | --- |
| 统一资源与命令 | `Buffer / Texture / Sampler / Program / RenderPipeline / BindGroup` 与 `beginRenderPass → setPipeline → setBindGroup → draw…` 全部与后端无关 |
| 三种后端 | **WebGL2**（完整实现）、**WebGPU**（完整实现）、**Mock**（无头 CPU 后端，Node 单测用） |
| 一套 UBO | `std140` 布局引擎同时驱动 GLSL `layout(std140)`、WGSL uniform 与 CPU 侧打包；支持**动态偏移环形 UBO**（共享材质逐物体矩阵，一次绘制换一个槽） |
| 内置材质 | `ColorMaterial`(Lambert) / `UnlitColorMaterial` / `PhongMaterial`(Blinn-Phong 高光) / `TextureMaterial`，自带 GLSL ES 3.00 + WGSL 双实现，支持 alpha 混合/双面/材质参数 |
| 灯光 | `AmbientLight` / `DirectionalLight`(平行光) / `PointLight` / `SpotLight`（锥角+半影），灯是场景图节点、可动画驱动；每帧自动收集打包进 `LightsBlock`（方向 4 / 点 8 / 聚 4，无灯时使用与历史等价的默认光） |
| 阴影 | `ShadowRenderer` + `light.castShadow`：方向光（正交自动拟合 + 纹素对齐）/ 聚光（透视）各一张深度贴图，3×3 PCF 软阴影；`mapSize`/`bias`/`normalBias`/`radius` 可调，WebGL2 与 WebGPU 结果一致（示例自检数值跨后端可比） |
| 实例化 | `InstancedMesh`：同一几何体 + 材质一次 draw 画 N 个实例（实例矩阵走 `stepMode: "instance"` 顶点流），自带脏区间上传、联合包围球剔除、阴影/拾取支持；与「N 个独立 Mesh」逐像素一致（示例自检 meanDiff = 0） |
| 内置几何 | box / plane / sphere / triangle / fullscreenTriangle + **cylinder(圆台/封口)/ cone / torus / capsule**；闭合几何保证**无边界边（没有洞）/无零面积三角形/无非流形边**，体积与解析值一致（单测守护） |
| 场景图与渲染器 | `Node3D`（层级/世界矩阵/脏标记）、`Scene`、`Mesh`（几何+材质+renderOrder+frustumCulled）、`SceneRenderer`（视锥剔除 + 不透明/半透明排序 + 渲染统计） |
| 交互 | `InputManager`（指针/滚轮/键盘 → NDC，click/dblclick 合成，多指，dispose） |
| 图形拾取 | `Raycaster`（CPU 包围球→三角形精确命中，按距离排序）+ `ColorPicker`（GPU 离屏 ID pass + 像素回读，逐像素精确） |
| 动画 | `KeyframeTrack`（数值/Vec3/颜色/**自定义绑定**）、`AnimationClip` + `AnimationMixer`/`AnimationAction`（播放/暂停/循环/**时间缩放**/淡入淡出）、`Tween`（`tweenNumber/tweenVec3/tweenColor/tweenObject` + `TweenManager`）、`Easing`（quad/cubic/sine/expo/back/elastic） |
| 纹理回读 | `device.readTexturePixels(...)`：WebGL2 / WebGPU / Mock 三后端统一（左上原点、紧凑 RGBA） |
| 离屏与后处理 | `RenderTarget`（格式/深度/**MSAA**/回读，三后端统一）+ `EffectComposer` 效果链（场景目标可选 MSAA → ping-pong 效果 → 呈现）；内置 `CopyPass`/`ToneMapPass`(ACES 等 4 种)/`BloomPass`/`VignettePass`/`GrayscalePass`/`ShaderPass`，自定义效果只要一对 fragment 源码 |
| 应用门面与插件 | `App`（device/renderer/scene/camera/input/mixer/tweens/picker/stats + 单循环 `step()`）、`Plugin` 生命周期（setup/update/beforeRender/afterRender/resize/dispose）、内置 `OrbitControlsPlugin` 与 `HighlightPlugin` |
| 数学库 | Vec2/3/4、Color、Mat4（perspective/ortho/lookAt/invert…），零依赖 |
| 测试 | 数学 / std140 / 格式表 / 几何生成 / 回读 / 场景图·拾取 / 交互 / 动画 / 灯光 / 阴影 / 后处理 / 实例化 / 资源缓存 / App·插件（`node --test`，129 个用例） |
| 示例 | 16 个可运行示例（同一源码切 WebGL2 / WebGPU），含 **2D 绘制**、**3D 材质与几何画廊**、**拾取**、**动画**、**灯光**、**阴影**、**后处理**、**实例化**、**App+插件**与 3 个**性能档位**示例 |

零运行时依赖；开发依赖仅 `typescript`、`@webgpu/types`（类型）、`esbuild`（示例打包）。

---

## 快速开始

```bash
npm install            # 安装开发依赖
npm run typecheck      # 严格类型检查（src + examples + tests）
npm test               # 构建并运行全部测试（97 个用例，无需浏览器/GPU）
npm run build          # 产出 ESM 到 dist/
npm run build:examples # esbuild 打包示例到 dist-examples/
npm run build:verify   # 打包内部验证页（_verify-shared / _verify-sphere）到 dist-examples/
npm run serve          # 本地静态服务 → http://localhost:8080/
```

打开 http://localhost:8080/ 后选择任意示例。默认 **WebGPU 优先，WebGL2 兜底**；
用 URL 参数强制后端：`?backend=webgl2` / `?backend=webgpu`。

### 2D 绘制（框架模块 `src/render2d` + 示例 `examples/shapes2d`）

框架内置了 Canvas2D 风格的 **`Canvas2D` 模块**（`src/render2d/`），
WebGL2 / WebGPU 共用一套实现：

- 路径：`rect / roundRect / line / quadraticCurveTo / bezierCurveTo /
  arc / arcTo / ellipse / closePath`（曲线自适应细分）；
- 填充与描边：`fill()`（凸/凹多边形、耳切）/ `stroke()`（`lineCap`
  butt·round·square，`lineJoin` miter·round·bevel，`miterLimit`，`lineWidth`）；
- 样式：十六进制 / `Color` / `LinearGradient`（多点）/ `RadialGradient`(近似)，
  `globalAlpha`；
- 变换与层级：`translate / rotate / scale / setTransform` + `save()/restore()`
  （连同样式、字体、裁剪一起压栈）；
- 裁剪：`clipRect` / `clip()`（轴对齐矩形，设备空间 scissor，可嵌套）；
- 文本：`fillText` + `font`（隐藏 canvas 栅格化字形 → 纹理缓存、随 fillStyle 着色）；
- 性能：CPU 三角化 → 动态合批，每帧少量 `drawIndexed`。

`examples/shapes2d` 展示了上述全部能力（含动画与裁剪层叠）。
模块用法与边界见 [docs/render2d.md](docs/render2d.md)。

### 3D 材质与几何

框架内置更多 3D 素材（`src/render/`）：

- **材质**：`ColorMaterial`（Lambert 漫反射）、`UnlitColorMaterial`（无光照纯色）、
  `PhongMaterial`（Blinn-Phong 高光：`shininess / specular / ambient` 参数，
  需要传入相机位置）、`TextureMaterial`（纹理 × Lambert）；统一支持
  `alphaBlend` 半透明与双面（`cullMode`）；
- **几何**：`cylinder`（上下半径可不同=圆台，可封口/开口）、`cone`、`torus`、
  `capsule`，全部带正确 UV/法线与朝外绕序（内置自检工具修正）；
- 示例 `examples/shapes3d` 以画廊形式展示几何 × 材质组合并旋转。

### 性能示例

三个性能示例共用 `examples/common/bench.ts` 的测量框架（默认**不自动换档**，
点击档位或 ←/→ 切换后停在那一档，`?cycle=1` 或空格才自动循环）：

| 示例 | 测量什么 | 档位 |
| --- | --- | --- |
| `perf-drawcalls` | 每物体一次 draw 的 CPU 开销（含 UBO 提交与绑定） | 500 → 40 000 个立方体 |
| `perf-instanced` | 单 draw 内实例化吞吐（顶点/光栅压力） | 4 096 → 262 144 个实例 |
| `perf-triangles` | 高细分网格的三角形吞吐 | 32×16 → 224×112 细分 ×4 份 |

- 每档先预热 12 帧，再取 90 帧窗口平均，右上角逐档显示 ms / fps（drawcalls 档另显示 **µs/draw**）；
- 渲染分辨率固定为 CSS 像素（可 `?scale=2`），保证不同档位可比。

### 性能（draw call 压力）

`examples/perf-drawcalls` 压的是「每物体一次 draw」这条最难的路径（默认**不自动换档**，
点击档位或 ←/→ 切换后停在该档，面板里显示 **µs/draw**）：

| draws | WebGL2 | WebGPU |
| --- | --- | --- |
| 6 000 | 16.9 ms · 59 fps | 16.9 ms · 59 fps |
| 10 000 | 25.7 ms · 39 fps | 16.9 ms · 59 fps |
| 20 000 | 68.4 ms · 15 fps | 28.5 ms · 35 fps |
| 40 000 | 132.7 ms · 8 fps | 51.9 ms · 19 fps |

> 无头 SwiftShader（CPU 光栅化）实测值；真实 GPU 上更高，但**相对关系**（WebGPU 快于 WebGL2、
> 每 draw 成本随规模的变化）一致。40 000 draws 属于压力档，真实项目里更推荐
> 实例化 / 合批（见 `perf-instanced`）。

框架为这条路径做的三件事：

1. **动态偏移环形 UBO**：一个材质实例 + 一条管线 + 一个 bind group 画任意多物体；
2. **提交前合批上传**：逐 draw 只写 CPU 暂存，`Device.onBeforeSubmit()` 把整帧合并成一次
   `buffer.write`（这一步把 6 000 draws 从 24 fps 提到 59 fps，并让 WebGPU 反超 WebGL2）；
3. **状态去重**：渲染通道编码器跳过同一 pass 内重复的 `setPipeline`/`setVertexBuffer`/
   `setIndexBuffer`，WebGL2 后端再加 VAO 快路径（20000 draws 时 74 ms → 44 ms）。
4. **资源内容缓存**：`createProgram` / `createRenderPipeline` 按内容指纹去重
   （同构材质只编译一次着色器、只建一条管线）；
5. **零分配命令编码**：动态偏移按值内联进 op（不再每次绘制分配 `offsets` 数组），
   逐 draw 复用的数组/临时对象集中在材质与编码器里。

细节见 [docs/architecture.md](docs/architecture.md) §3.1 / §3.2。

### 场景图、拾取与交互

`Scene` / `Node3D` 提供层级变换（local/world 矩阵 + 脏标记），`Mesh` 组合几何与材质；
`SceneRenderer` 负责一次自顶向下更新、视锥剔除与排序，并输出 `stats`
（objects/drawn/culled/triangles/nodes）：

```ts
const scene = new Scene();
const mesh = new Mesh(Geometry.create(device, box()));
mesh.model.setIdentity().translate(0, 1, 0);
mesh.material = new ColorMaterial(device, new Color().setHex("#4c8dff"));
scene.add(mesh);

const sceneRenderer = new SceneRenderer();
sceneRenderer.render(pass, scene, camera);   // 内部：世界矩阵 → 剔除 → 排序 → 绘制
```

拾取有两条互补的路径（示例 `examples/picking` 同时演示并互相对照）：

```ts
// 1) CPU 几何拾取：包围球 → 三角形（Möller–Trumbore），适合 hover/精确到面
const raycaster = new Raycaster();
raycaster.setFromCamera(camera, ndc.x, ndc.y);
const hit = raycaster.intersectFirst(scene);   // { object, distance, point, normal, faceIndex }

// 2) GPU 颜色拾取：离屏 ID pass + 1×1 像素回读，逐像素精确（含任意遮挡/alpha 逻辑）
const picker = new ColorPicker(device);
const result = await picker.pick(scene, camera, { x: ndc.x, y: ndc.y });   // { mesh, id, color, pixel }
// 多点批量（一次 ID pass + 一次回读）：await picker.pickMany(scene, camera, points)
```

`InputManager` 把浏览器事件统一成 NDC（y 向上）并合成 click/dblclick：

```ts
const input = new InputManager(canvas);
input.on("pointermove", (e) => { picker.pick(scene, camera, e.ndc).then(/* 高亮 */); });
input.on("click", (e) => console.log(e.ndc.x, e.ndc.y));
```

细节与性能建议见 [docs/picking.md](docs/picking.md)。

### 动画（`src/animation`）

```ts
// 1) 关键帧轨道（自定义绑定：任何 (value) => void 都能被驱动）
const hop = new AnimationClip("hop", { duration: 1 }).addTracks(
  nodePositionTrack(mesh, vec3Keys([
    { time: 0,   value: [0, 0, 0], easing: "quadOut" },
    { time: 0.5, value: [0, 2, 0], easing: "quadIn" },
    { time: 1,   value: [0, 0, 0] },
  ])),
  materialColorTrack(material, colorKeys([{ time: 0, value: "#4c8dff" }, { time: 1, value: "#ff5c8a" }])),
);

// 2) 播放（循环 / 时间缩放 / 淡入淡出）
const mixer = new AnimationMixer(scene);
mixer.play(hop, { loop: "ping-pong" });
mixer.timeScale = 0.5;
mixer.update(dt);                      // 每帧

// 3) Tween：一次性的小动效
const tweens = new TweenManager();
tweens.add(tweenNumber(0, 1, 0.3, (v) => panel.setOpacity(v), { easing: "backOut" }));
tweens.add(tweenObject(mesh.scale, { x: 1.6, y: 1.6, z: 1.6 }, 0.2, { yoyo: true, repeat: 1, markDirty: true }));
tweens.update(dt);
```

示例 `examples/animation` 同时演示层级动画（父节点旋转带动子树）、关键帧、Mixer 与 Tween，
并可用键盘切换循环模式与时间缩放。详见 [docs/animation.md](docs/animation.md)。

### 离屏渲染与后处理（`src/render/RenderTarget.ts` + `src/render/postfx`）

```ts
import { RenderTarget, EffectComposer, BloomPass, ToneMapPass, VignettePass } from "unidraw";

// 1) 离屏目标（可选 MSAA，WebGL2 用 renderbuffer + blit 解析，WebGPU 用 resolveTarget）
const target = new RenderTarget(device, { width: 1280, height: 720, sampleCount: 4 });
const encoder = device.createCommandEncoder("offscreen");
const offscreen = encoder.beginRenderPass({
  colorAttachments: [target.colorAttachment()],
  depthStencilAttachment: target.depthAttachment(),
});
sceneRenderer.render(offscreen, scene, camera);
offscreen.end();
device.submit([encoder.finish()]);
const pixels = await target.readPixels();   // 三后端统一的回读

// 2) 后处理链：场景 → (MSAA resolve) → 泛光 → 色调映射 → 暗角 → 画布
const composer = new EffectComposer(device, { width: canvas.width, height: canvas.height, sampleCount: 4 });
composer.addPass(new BloomPass(device, { threshold: 0.65, strength: 1.1 }));
composer.addPass(new ToneMapPass(device, { mode: "aces", exposure: 1.15 }));
composer.addPass(new VignettePass(device, { strength: 0.45 }));
composer.render((pass) => sceneRenderer.render(pass, scene, camera));
```

- 用离屏链路的材质要声明 `targetFormat`（默认取画布格式），否则 WebGPU 会报附件格式不匹配；
- 效果管线按链路格式创建，最后自动用一趟与**输出格式**匹配的拷贝 pass 呈现
  （所以 WebGL2 画布 `rgba8unorm` 与 WebGPU 画布 `bgra8unorm` 都不需要特殊处理）；
- 自定义效果继承 `FullScreenPass` 即可，只要一对 GLSL + WGSL fragment 源码；
- 示例 `examples/postfx`（B 泛光 · T 色调映射 · V 暗角 · M MSAA · P 整链开关）自带
  `POSTFX_SELFTEST`，可跨后端对比像素统计。

详见 [docs/postfx.md](docs/postfx.md)。

### 阴影（Shadow Map，`src/render/shadow`）

```ts
import { DirectionalLight, ShadowRenderer, Vec3 } from "unidraw";

const sun = new DirectionalLight(new Vec3(-0.5, -1, -0.4), "#fff3d6", 1.0);
sun.castShadow = true;        // 打开阴影；sun.shadow.mapSize / bias / radius 可调
scene.add(sun);

const shadows = new ShadowRenderer(device);
shadows.renderAndSubmit(scene, camera, sceneRenderer);   // 每帧：必须在主 pass 之前提交
sceneRenderer.render(renderer.beginFrame(), scene, camera);
renderer.endFrame();

// 用 App 时更省事：App.create(canvas, { shadows: true })
```

- 方向光用**正交自动拟合**（可见物体包围球 + 纹素对齐），聚光用透视拟合（视场角 = 外锥角）；
- 阴影贴图是 `depth32float` 深度纹理，着色器用 `texelFetch`/`textureLoad` 手动比较
  + 3×3 PCF —— 不需要比较采样器/扩展，两个后端结果一致；
- 一次着色最多 4 张（`MAX_SHADOW_MAPS`），超出的投影灯计入 `shadows.stats.skipped`；
- 示例 `examples/shadows` 自带 `SHADOW_SELFTEST`（阴影比例、阴影是否随光移动、整体曝光不变）。

详见 [docs/shadows.md](docs/shadows.md)。

### 应用门面与插件（`src/app`）

```ts
import { App, OrbitControlsPlugin, HighlightPlugin } from "unidraw";

const app = await App.create(canvas, { backend: "auto" });
app.scene.add(mesh);
app.mixer.play(clip, { loop: "ping-pong" });
app.use(new OrbitControlsPlugin());
app.use(new HighlightPlugin({ highlight: highlightMaterial, onSelect: (m) => console.log(m?.name) }));
app.onRender((pass) => { /* 额外绘制 */ });
app.start();                 // 或固定步长 app.step(1/60)
console.log(app.stats);      // frames/fps/dt + objects/drawn/culled/triangles
```

`step()` 固定顺序：尺寸检测 → 插件 `update` → `mixer` → `tweens` → `beginFrame` →
`beforeRender` → 内置 `SceneRenderer`（可关）→ `onRender` → `afterRender` → `endFrame` → stats。
插件生命周期 `setup/update/beforeRender/afterRender/resize/dispose`，`dispose` 逆序调用。
示例 `examples/app` 用「轨道相机 + 拾取高亮 + 自定义 HUD 插件 + 动画 + Tween」串起完整应用；
详见 [docs/app.md](docs/app.md)。

### 一个最小例子（与后端无关）

```ts
import { createDevice, Renderer } from "unidraw";

const canvas = document.querySelector("canvas")!;
const renderer = await Renderer.create(canvas, { backend: "auto" });

const geometry = Geometry.create(device, box());
const material = new ColorMaterial(device, new Color().setHex("#4c8dff"));
const mesh = new Mesh(geometry);

function frame() {
  const pass = renderer.beginFrame();
  material.beginFrame(camera.viewProjection);
  mesh.model.rotateY(0.01);
  material.draw(pass, mesh);
  renderer.endFrame();
  requestAnimationFrame(frame);
}
frame();
```

> 同一段代码在 WebGL2 与 WebGPU 下给出相同画面 —— 这就是“统一绘制命令”。

### 故障排查

- WebGPU 渲染为空时优先看控制台：框架会**无条件打印** WGSL 编译诊断
  （`[unidraw] WGSL 编译诊断`）与校验错误（`[unidraw] WebGPU validation error`）。
- 常见陷阱：渲染通道带**深度附件**时，参与该 pass 的每条管线都必须声明匹配的
  `depthStencil`（WebGPU 校验规则）。纯 2D 绘制请关闭深度：
  `new Renderer(canvas, { depth: false })`，或在 URL 后加 `?depth=0` 对比。
- 无头验证（无需真实显示器/GPU，SwiftShader）：
  ```bash
  EXTRA_CHROME_FLAGS=--enable-unsafe-swiftshader \
    node tools/browser-probe.mjs "http://localhost:8080/triangle/index.html?backend=webgpu" wgpu
  node tools/pngprobe.mjs shot-wgpu.png   # 像素统计
  ```

---

## 目录结构

```
src/
  math/        vec2/3/4、Color、Mat4、工具
  gpu/         types（统一枚举）、formats（顶点/纹理格式表）、std140 布局引擎
  device/      Device 抽象、descriptors、createDevice 工厂
    resource/  一个类一个文件（ResourceBase/Buffer/Texture/TextureView/Sampler/
               Program/BindGroupLayout/BindGroup/RenderPipeline）
    resources.ts  barrel：保持 `device/resources.js` 导入路径不变
    backend/   webgl2 / webgpu / mock（无头）
               constants.ts + gpuUtils.ts + resources/<每类一个文件> + <Backend>Device.ts
  command/     ops.ts（统一命令）、CommandBuffer / RenderPassEncoder / CommandEncoder
               （encoder.ts 为 barrel，保持 `command/encoder.js` 不变）
  render/      Camera、Geometry、Mesh、InstancedMesh、UniformBlock、Renderer 门面、
               RenderTarget
    material.ts / shaders.ts / primitives.ts / texture.ts 均为 barrel；
    实现按「一个类/一个几何体/一份材质一个文件」放在同目录或子目录
    （materialCommon.ts、shaders/*、primitives/*、texture/*）
    postfx/    EffectComposer + FullScreenPass（效果契约）+ 每种效果一个文件
               （CopyPass/ToneMapPass/BloomPass/VignettePass/GrayscalePass/ShaderPass）
    shadow/    ShadowRenderer + ShadowMap/ShadowCamera/ShadowState/ShadowResources
               + ShadowDepthMaterial（只写深度的材质）
  render2d/    Canvas2D 完整 2D：路径/贝塞尔/arc/圆角矩形、填充描边、渐变、
               变换、文本、裁剪（WebGL2/WebGPU 共用）
               path.ts / style.ts / renderer2d.ts 为 barrel，实现拆到
               Path2D.ts、pathTypes.ts、color.ts、LinearGradient.ts、
               RadialGradient.ts、paint.ts、Canvas2D.ts、types.ts、geometry2d.ts
  __tests__    node --test 测试
examples/      16 个示例 + common/（demo 引导、bench 测量框架）
tools/         零依赖静态服务、esbuild 示例打包
docs/          中文文档（见下）
```

> 约定：**一个文件一个类/一个职责**，跨模块引用一律走同名 barrel
> （`device/resources.js`、`command/encoder.js`、`render/material.js`、
> `render/shaders.js`、`render/primitives.js`、`render2d/path.js` …），
> 因此重构文件布局不会影响使用方导入路径。

---

## 设计速览

- **统一命令流**：所有绘制被记录为与后端无关的 op 列表（`command/ops.ts`），
  提交时由各后端翻译执行。CommandBuffer 不可变、可重放、可被测试/序列化。
- **Uniform 全部走 UBO**：内置材质没有 `uniform1f` 之类逐字段调用；
  布局由 `std140` 引擎统一推导（GL/WGSL/CPU 三方一致）。
- **BindGroup 等价物**：WebGL2 后端在创建 BindGroupLayout 时静态分配
  UBO binding point / 纹理单元，绑定资源即 `bindBufferBase` + `bindTexture`。
- **WebGPU 语义对齐**：命令/管线/绑定模型按 WebGPU 设计，WebGL2 是翻译层。
  深度测试跨后端一致（WebGL2 用默认帧缓冲深度；WebGPU 用设备内部深度纹理）。

详细内容见 [docs](docs/)：

- [架构与设计](docs/architecture.md)
- [统一绘制命令规范](docs/command-spec.md)
- [render2d 2D 绘图模块](docs/render2d.md)
- [场景图 / 交互 / 拾取](docs/picking.md)
- [动画（关键帧 · Mixer · Tween）](docs/animation.md)
- [灯光（环境光/方向光/点光/聚光）](docs/lighting.md)
- [阴影（Shadow Map）](docs/shadows.md)
- [实例化（InstancedMesh）](docs/instancing.md)
- [离屏渲染与后处理（RenderTarget · MSAA · EffectComposer）](docs/postfx.md)
- [App 门面与插件](docs/app.md)
- [着色器写作指南](docs/shader-guide.md)
- [扩展指南（新后端 / 新材质 / 新示例）](docs/extension.md)

---

## 路线图（可能的后续）

- 点光阴影（cube map；WebGL2 需要每面各跑一趟）
- 计算管线 / 存储缓冲 / indirect draw
- 命令编码去 GC（当前已内联动态偏移、去掉逐 draw 数组分配）
- 更激进的实例化（实例动画放进 vertex/compute）
- 纹理压缩格式、mipmap 自动生成（WebGL2 `generateMipmaps`、`maxAnisotropy`）
- 更完整的数学（四元数、AABB、射线）
- WebGPU 原生 GPU 队列级编码（当前在 submit 时翻译统一命令，换取三后端一致性）

## License

MIT
