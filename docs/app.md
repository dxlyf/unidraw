# App 门面与插件

模块：`src/app`；示例：`examples/app`。

`App` 把「设备 / 渲染器 / 场景 / 相机 / 输入 / 动画 / 补间 / 拾取 / 插件 / 主循环」
装成一个对象，业务代码只需要写 `step` 里要画什么：

```ts
import { App, OrbitControlsPlugin, HighlightPlugin } from "unidraw";

const app = await App.create(canvas, { backend: "auto", background: "#0d1017" });

app.scene.add(mesh);
app.mixer.play(clip, { loop: "ping-pong" });
app.use(new OrbitControlsPlugin());
app.use(new HighlightPlugin({ highlight: highlightMaterial, onSelect: (m) => console.log(m?.name) }));
app.onRender((pass) => { app.sceneRenderer.render(pass, app.scene, app.camera); });

app.start();               // requestAnimationFrame 循环
// 或固定步长：app.step(1 / 60)
```

---

## 1. 一行拿到的东西

| 成员 | 说明 |
| --- | --- |
| `app.device` / `app.renderer` / `app.canvas` | 设备与渲染会话（`App.create` 内部调用 `Renderer.create`） |
| `app.scene` / `app.camera` / `app.sceneRenderer` | 场景图、相机、内置渲染器（视锥剔除 + 排序 + stats） |
| `app.input` | `InputManager`（`input: false` 时为 `null`；无 canvas 环境自动为 `null`） |
| `app.mixer` / `app.tweens` | `AnimationMixer` / `TweenManager`，`step()` 里自动推进 |
| `app.picker` | 懒创建的 `ColorPicker`（GPU 颜色拾取，尺寸跟随画布） |
| `app.raycaster` / `app.raycast(ndc)` | CPU 几何拾取便捷方法 |
| `app.stats` | `frames / dt / fps / time / width / height` + `objects / drawn / culled / triangles / nodes` |
| `app.plugins` | 已注册插件（按注册顺序） |

`App.create(canvas, options)` 是异步的（要创建设备）；测试/复用设备时用
`App.fromDevice(device, canvas, options)`（同步，Mock 后端也能用）。

`step(dt)` 的固定顺序：

```
尺寸检测/纵横比 → 插件 update → mixer.update → tweens.update
→ beginFrame → 插件 beforeRender → sceneRenderer.render（可关）
→ onRender 回调 → 插件 afterRender → endFrame → stats
```

- `dt` 会被 clamp 到 `[0, 0.25]` 秒（切页/断点不会让动画“瞬移”）；
- `step()` **不可重入**：不要在 `onRender`/插件钩子里再次调用（会得到明确的报错）；
  需要“跑一段固定时间”时请延后到当前帧结束（`setTimeout(..., 0)`）；
- `renderScene: false` 时 App 不做默认绘制，完全交给 `onRender`。

---

## 2. 插件（Plugin）

```ts
export interface Plugin {
  name?: string;
  setup?(ctx: PluginContext): void | Promise<void>;      // App 就绪；可 async
  update?(ctx: PluginContext, dt: number, time: number): void;   // 每帧、渲染前
  beforeRender?(ctx: PluginContext, pass: RenderPassEncoder): void;
  afterRender?(ctx: PluginContext, pass: RenderPassEncoder): void;
  resize?(ctx: PluginContext, width: number, height: number): void;
  dispose?(ctx: PluginContext): void;                    // 逆序调用
}
```

- 注册：`app.use(plugin)`（链式，不等待 async setup）或
  `await app.useAsync(plugin)`（等待 setup 完成）；
- `PluginContext` 提供 `device / renderer / scene / camera / sceneRenderer /
  input / mixer / tweens / picker / width / height`；
- `dispose()` 按**注册逆序**调用，`App.dispose()` 也会释放 input、mixer、picker 与补间。

最小插件写法：

```ts
import { definePlugin } from "unidraw";

app.use(definePlugin({
  name: "hud",
  setup(ctx) { el.textContent = `${ctx.width}x${ctx.height}`; },
  update(ctx, dt, time) { el.textContent = `fps=${app.stats.fps.toFixed(0)}`; },
  resize(_ctx, w, h) { console.log("resize", w, h); },
  dispose() { el.remove(); },
}));
```

### 内置插件

- **`OrbitControlsPlugin`**：指针拖拽旋转 + 滚轮缩放（基于 `InputManager`，无自己的 DOM 监听）。
  可调 `rotateSpeed / zoomSpeed / minDistance / maxDistance / minPitch / maxPitch`；
  `dragging` / `draggedDistance` / `isClick` 供拾取逻辑区分「拖拽」与「点击」。
- **`HighlightPlugin`**：悬停/点击高亮。
  - **选中 ∪ 悬停会同时高亮**：插件用一张 Map 记录每个被接管对象的原材质，
    离开高亮集合时精确恢复（不会互相踩掉、也不会「选中后移开鼠标高亮消失」）；
  - 每次拾取都用当前场景/相机重绘 ID pass（`autoInvalidate: true`，默认），
    避免读到过期 ID 目标而高亮到错误物体；要省一次 pass 就设 `autoInvalidate: false`
    并在场景/相机变化后调用 `invalidate()`；
  - `skipWhileDragging: () => orbit.dragging` 可在拖动相机期间跳过拾取；
  - `hovered` / `selected` / `highlightedCount` 可读，`clearSelection()` 清空选中，
    `hoverAt(ndc)` / `selectAt(ndc)` 可用程序化 NDC 立即拾取（触摸或自绘 UI 场景）；
  - `picker` 选项可换成自定义拾取来源（任何实现 `pick(scene, camera, ndc)` 的对象，
    例如包一层 `Raycaster` 做同步拾取）；
  - 拾取本身是异步的（一次 GPU→CPU 回读），快速移动时高亮会略滞后；
    要零延迟就用射线驱动高亮（见 `examples/picking`）。

---

## 3. 和动画/拾取的配合

`examples/app` 把三样东西串起来：

1. `AnimationClip` + `Mixer`：整个场景缓慢摆动 + 某个物体上下浮动（ping-pong）；
2. `Tween`：地面颜色呼吸、点击物体时“弹出再弹回”（`yoyo + repeat`）；
3. `HighlightPlugin` + `OrbitControlsPlugin`：悬停高亮、点击选中并触发 Tween；
   自检里再用 `app.raycast()` 与 `app.picker.pickPixel()` 交叉验证命中一致。

---

## 4. 无头验证（`APP_SELFTEST`）

`examples/app?selftest=1`（默认开）会：

1. `app.stop()` 停表 → 画布 resize → 固定视角；
2. 把所有 Action `seek(0)` 归零后用固定 `1/60` 步进 30 帧（= 0.5s）；
3. 校验：帧数/时间步进、`stats`（objects/drawn/culled/triangles）、轨道求值写回
   （`y = 0.75 + 0.75·sineInOut(0.25) ≈ 0.8598`）、插件数量与 HUD 生命周期、
   resize 生效、CPU 与 GPU 拾取逐点一致；
4. 在控制台打印 `APP_SELFTEST {...}`，然后恢复循环。

两个后端输出**完全一致**（数值含小数位都相同），可作为改造 App/插件后的回归依据。

---

## 5. 陷阱

- **`Camera.pitch` 为正 = 相机在目标「上方」（俯视）**：
  `update()` 按 `eye = center + distance·(cos p·sin y, sin p, cos p·cos y)` 推导，
  因此想让相机俯视一个放在 `y=0` 平面上的场景，`pitch` 必须取**正值**；
  写成负值会让相机钻到地板下面，只能看到地板背面 —— 表现为「示例什么都没渲染」。
- `App.create` 需要 `document`（示例在模块顶层 `await`）；无头/Node 场景用
  `App.fromDevice(device, canvasLike, { input: false, autoResize: false })`；
- **canvas 必须有 CSS 尺寸**（例如 `width:100vw;height:100vh`）。
  没有 CSS 尺寸时 canvas 的显示尺寸等于 drawing buffer 尺寸，
  `resizeToDisplaySize()` 再乘 devicePixelRatio 会让 buffer 每帧翻倍
  （画面被推到视口之外）；框架已加防护（跳过放大并打印一次警告），
  但正确做法还是给它 CSS 宽高。
- `app.resize(w, h)` 会直接改画布后备缓冲尺寸（像素）；
  `autoResize !== false` 时下一帧会按 CSS 尺寸自动校正回去；
- 在 `onRender` 里不要再调用 `app.step()`；异步逻辑（拾取、加载）请 `await` 后再 `requestAnimationFrame`；
- App 的 `sceneRenderer` 是**共享**的：插件里的自定义 pass 建议用
  `ctx.sceneRenderer.collectVisible()` 复用剔除结果，而不是重新遍历场景；
- `SceneRenderer.render()` 会在绘制前自动把相机喂给本次用到的每个材质
  （`MaterialLike.beginFrame`），自己组织 pass 时仍需手动调 `material.beginFrame(...)`。
