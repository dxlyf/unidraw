# 场景图 · 交互 · 拾取

本篇覆盖 `src/scene`、`src/interaction`、`src/picking` 与配套的 `readTexturePixels`。
示例：`examples/picking`（射线 + 颜色拾取对照）、`examples/shapes3d`（场景图 + 材质）。

---

## 1. 场景图（`src/scene`）

```
Node3D                层级节点：matrix(局部) / worldMatrix、add/remove/traverse/traverseVisible
 ├─ Scene             场景根（语义化 Node3D 子类）
 └─ Mesh              几何 + 材质 + renderOrder + frustumCulled（继承 Node3D）
```

- **世界矩阵与脏标记**：`Node3D.updateWorldMatrix(force?)` 自顶向下传播，
  局部矩阵用 16 个浮点数快照比对判断脏；只有变化过的子树才重算。
  父节点版本号变化也会让子树失效，因此移动父节点后子节点会自动跟随。
- **包围体**：`Mesh.updateWorldBounds(force?)` 维护 `worldCenter / worldRadius`
  （世界包围球），供视锥剔除与射线预筛使用；几何自身的 `boundingSphere*` / `aabb*`
  在 `Geometry.create()` 时由顶点数据算出。
- **可见性**：`node.visible` 与 `traverseVisible()` 配合，隐藏节点整棵子树跳过。
- **CPU 数据保留**：`Geometry.create(device, data, { retainCPU: true })` 会保留
  `positionsCPU / indicesCPU` —— 射线拾取（`Raycaster`）需要它；纯 GPU 网格可关闭以省内存
  （此时拾取请用颜色拾取）。

### SceneRenderer

```ts
const sceneRenderer = new SceneRenderer();
sceneRenderer.frustumCulling = true;   // 视锥剔除
sceneRenderer.sort = true;             // renderOrder → 不透明近→远 → 半透明远→近
sceneRenderer.render(pass, scene, camera, {
  overrideMaterial: null,              // 强制材质（如拾取 ID 材质、调试材质）
  filter: (mesh) => mesh.visible,      // 自定义过滤
});
console.log(sceneRenderer.stats);      // { objects, drawn, culled, triangles, nodes }
```

`collectVisible(scene, camera, options)` 返回「已剔除、已排序」的 Mesh 数组
（内部复用缓冲，下次调用即失效）。自定义 pass（拾取 / 阴影 / 描边）复用它即可
获得与主渲染完全一致的剔除与排序结果。

---

## 2. 交互（`src/interaction`）

```ts
const input = new InputManager(canvas, { preventWheelDefault: true });

input.on("pointermove", (e) => console.log(e.ndc.x, e.ndc.y));  // NDC：-1..1，y 向上
input.on("click", (e) => { /* 按下-抬起位移 < 6px 且 < 600ms 才合成 click */ });
input.on("dblclick", (e) => {});
input.on("wheel", (e) => console.log(e.wheelDelta));
input.on("keydown", (e) => { if (e.code === "Escape") selected = null; });

input.isKeyDown("ShiftLeft");     // 按键集合
input.pointerCount;               // 多指
input.dispose();                  // 移除全部监听（组件卸载时调用）
```

- `clientToNdc(rect, clientX, clientY)` 可单独使用（例如把 DOM 事件转成 NDC）；
- 拖拽与点击不互相干扰：拖拽超过阈值只产生 pointer 事件，不产生 click；
- 所有处理器都能用返回值取消注册：`const off = input.on(...); off();`

---

## 3. 拾取（`src/interaction` + `src/picking`）

### 3.1 CPU 几何拾取：`Raycaster`

```ts
const raycaster = new Raycaster({ backfaceCulling: false, firstHitOnly: true });
raycaster.setFromCamera(camera, ndcX, ndcY);
const hit = raycaster.intersectFirst(scene);
// hit: { object: Mesh, distance, point: Vec3, normal: Vec3, faceIndex } | null
const all = raycaster.intersectObjects(scene);   // 按距离升序
```

- 世界矩阵的逆把射线变换到物体空间（方向**不归一化**，保证 `t` 与世界距离一致），
  因此非均匀缩放/旋转的物体也能得到正确的世界命中点与法线；
- `setFromCamera()` 的射线**原点在近平面上**（不是相机眼睛位置），
  所以 `hit.distance` 是「从近平面起算」的距离；要拿到与眼睛的距离请用
  `camera.eyePosition.distanceTo(hit.point)`；
- 加速：局部包围球预筛 → 逐三角形 Möller–Trumbore；
- 需要几何保留 CPU 数据（`retainCPU: true`，默认开启）。大网格建议先用
  `Frustum` / 包围球做粗筛，或改用颜色拾取。

### 3.2 GPU 颜色拾取：`ColorPicker`

```ts
const picker = new ColorPicker(device, { label: "picker" });
const r = await picker.pick(scene, camera, { x: ndc.x, y: ndc.y });
// r: { mesh, id, color: {r,g,b,a}, ndc, pixel }
const many = await picker.pickMany(scene, camera, points);   // 一次 ID pass + 一次回读

picker.render(scene, camera);        // 手动渲染 ID pass
await picker.pickPixel(ndc);         // 复用同一 pass 多次查询（不重绘）
picker.resize(w, h);                 // 画布尺寸变化后调用
picker.invalidate();                 // 标记 ID 目标过期（配合 refresh:false / pickPixel）
picker.dispose();
```

**失效契约（很重要）**：

| 调用 | 是否重绘 ID pass | 用途 |
| --- | --- | --- |
| `pick()` / `pickMany()` | **是（默认每次）** | 常规拾取；相机/物体变化后必须这样用 |
| `pick(..., { refresh: false })` | 否 | 明确知道本帧场景与相机不变时省一次 pass |
| `pickPixel()` | 否 | 先 `render()`，再连续查询多个点 |
| `render()` | 是（显式） | 手动控制时机（配合 `pickPixel` / `invalidate`） |

> 复用一个**过期**的 ID 目标会拾取到「上一帧那个位置上的物体」：
> 相机一转、物体一动就会开始高亮错对象（而且 CPU 射线看起来「更准」——
> 因为它每次都是实时计算的）。所以默认选择「每次都重绘」这个不易用错的语义。

原理：

1. `IdMaterial` 把「物体编号」编码成颜色（`id = r | g<<8 | b<<16`）绘制到离屏
   `rgba8unorm` 纹理（带深度，剔除/深度行为与正式渲染一致）；
2. `device.readTexturePixels()` 回读目标像素，颜色即编号，映射回 `Mesh`。

关键实现点：

- **一个材质绘制全部物体**：每个物体在 ID 材质里占一个**动态偏移环形 UBO 槽**
  （binding 3，`hasDynamicOffset`），所以不需要「每物体一个材质/UBO/管线」；
- WebGPU `queue.writeBuffer` 先于 render pass 执行，因此同一提交内每个 draw
  必须用**不同槽位**；游标在 `beginFrame()` 或检测到 `device.submitCount`
  变化时归零（槽位可安全复用）；
- 回读是异步的（一次 GPU→CPU 往返）：hover/click 时拾取没问题，
  **不要每帧对每个物体拾取**；需要多个点时用 `pickMany`（一次回读）。

**悬停高亮的延迟建议**：颜色拾取要等一次 GPU→CPU 回读（几百 µs ~ 数 ms），
鼠标快速移动时高亮会略滞后于光标。需要「零延迟、与光标严格一致」的悬停反馈时，
用**同步**的 `Raycaster` 驱动高亮，把颜色拾取留给需要像素级精确的场合
（示例 `examples/picking` 就是这么做的：高亮走射线，颜色拾取只做对照统计）。

### 3.3 两条路径怎么选

| | `Raycaster`（几何） | `ColorPicker`（颜色） |
| --- | --- | --- |
| 精度 | 三角形级（可拿到面/法线/命中点） | 像素级（与最终画面一致，含遮挡/alpha） |
| 成本 | 纯 CPU，随三角形数增长 | 一次离屏渲染 + 一次回读（异步） |
| 需要 CPU 数据 | 是（`retainCPU`） | 否 |
| 适合 | 编辑器 gizmo、精确到面、离线计算 | hover 高亮、点选、超复杂几何/蒙版材质 |

`examples/picking` 同时运行两条路径，并在控制台打印自检结果：

```
PICK_SELFTEST {"backend":"webgl2","samples":40,"agree":40,"ratio":1,"allAgree":true,...}
```

（40 个采样点上「颜色拾取」与「射线拾取」命中的是同一个物体 —— 两个后端结果一致。）

---

## 4. 纹理回读：`device.readTexturePixels`

```ts
const pixels = await device.readTexturePixels(texture, { x, y, width, height });
// 左上原点、紧凑 8bit RGBA（width*height*4）
```

| 后端 | 实现 | 备注 |
| --- | --- | --- |
| WebGL2 | 临时 FBO + `readPixels` + Y 翻转 | 纹理需 `RENDER_ATTACHMENT` |
| WebGPU | `copyTextureToBuffer` + `mapAsync` | 纹理需 `COPY_SRC`；行按 256 字节对齐后重排 |
| Mock | 直接读 CPU 像素 | 无头测试用 |

支持 `rgba8unorm` / `rgba8unorm-srgb` / `bgra8unorm` / `bgra8unorm-srgb`
（后两者自动 swizzle 成 RGBA）。其他格式会抛错。

---

## 5. 常见陷阱

- **离屏渲染的附件格式必须与管线 target 一致**：材质的 `targetFormat` 缺省取画布格式
  （WebGPU 下通常是 `bgra8unorm`），渲染到自定义 `rgba8unorm` 纹理时要显式传入
  `{ targetFormat: "rgba8unorm" }`，否则 WebGPU 会报 “Attachment state … not compatible”。
- **共享材质 + 逐物体矩阵**：直接用同一个材质实例绘制多个 Mesh 是支持且推荐的
  （模型矩阵走动态偏移槽）；但材质自身的 `u_color` 等参数仍是「每材质」的，
  需要**每物体不同颜色**时请为每个物体建一个材质实例。
- **深度附件**：WebGPU 中 pass 带深度附件时，参与绘制的管线都必须声明匹配的
  `depthStencil`（材质的 `depth` 选项缺省 true）。
- **拾取目标尺寸**：`ColorPicker` 的 NDC→像素映射基于它自己的目标尺寸，
  画布 resize 后记得 `picker.resize(w, h)`。
