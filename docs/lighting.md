# 灯光（环境光 · 方向光 · 点光 · 聚光）

模块：`src/render/lights`；示例：`examples/lights`。

四种灯都是**场景图节点**（继承 `Node3D`），所以可以挂在任意父节点下、被动画驱动、
用 `visible` 开关：

```ts
import { AmbientLight, DirectionalLight, PointLight, SpotLight } from "unidraw";

scene.add(new AmbientLight("#5b6f96", 0.5));                              // 环境光：整体抬亮
scene.add(new DirectionalLight(new Vec3(0.45, -0.8, -0.4), "#ffe6c2", 0.9)); // 方向光：只有方向

const bulb = new PointLight("#ff4d6d", 30, 16, 2);                        // 点光：位置 + 距离衰减
bulb.setPosition(2, 3, 0);
scene.add(bulb);

const spot = new SpotLight("#ffffff", 60);                                // 聚光：位置 + 方向 + 锥角
spot.setPosition(0, 7, 0);
spot.setDirection(0, -1, 0).setAngle(degToRad(22), 0.4);                  // (外锥半角, penumbra)
spot.distance = 24;
scene.add(spot);
```

用 `SceneRenderer` / `App` 渲染时，灯光会**自动收集**并喂给材质，不需要任何额外调用：

```ts
sceneRenderer.render(pass, scene, camera);   // 内部：collectLights → material.beginFrame(vp, eye, lights)
```

自己组织 pass（例如拾取、阴影）时可以手动：

```ts
const lights = new LightsState();
collectLights(scene, lights);                // 遍历场景打包（零分配）
material.beginFrame(camera.viewProjection, camera.getEyePosition(), lights);
```

---

## 1. 各类型参数

| 类型 | 关键参数 | 说明 |
| --- | --- | --- |
| `AmbientLight` | `color`、`intensity` | 无方向无位置；多个环境光按 `颜色×强度` **累加** |
| `DirectionalLight` | `direction`（世界空间**传播方向**）、`color`、`intensity` | 平行光（太阳）；**位置不影响**结果，缺省 `(0,-1,0)` 自上而下 |
| `PointLight` | `color`、`intensity`、`distance`、`decay` | 位置 = 节点**世界位置**；`distance=0` 表示无限远（只按 decay 衰减），`decay=2` 为平方反比 |
| `SpotLight` | 上列全部 + `angle`（外锥半角，弧度）、`penumbra`（0 硬边 ~ 1 全软） | 位置 = 世界位置、方向显式给出 |

上限（每个 shader 内，超出会被忽略并计入 `LightsState.overflow`）：
**方向光 4 · 点光 8 · 聚光 4**，环境光不限（累加成一个颜色）。

## 2. 衰减与锥角公式（fragment 内）

```
点光：  L = lightPos - worldPos, d = |L|
        atten = 1 / max(d, 1e-4)^decay
        range > 0 时：atten *= (clamp(1 - (d/range)^4, 0, 1))²      // 平滑截断，避免硬边
        diffuse += color × max(dot(n, L/d), 0) × atten

聚光：  cone = smoothstep(cosInner, cosOuter, dot(-L/d, direction))
        atten = cone / max(d, 1e-4)^2      // 再乘 range 截断
        cosOuter = cos(angle)，cosInner = cos(angle × (1 - penumbra))  // CPU 侧预计算
```

方向光无衰减；环境光直接累加。高光（`PhongMaterial`）为 Blinn-Phong：
`h = normalize(L + V)`，指数 `shininess`，强度 `specular`，颜色取自灯光颜色。

## 3. 与材质的关系

| 材质 | 是否受灯光影响 | 说明 |
| --- | --- | --- |
| `ColorMaterial` | ✅ Lambert | `u_color × lighting` |
| `PhongMaterial` | ✅ Blinn-Phong | `u_color × lighting + specular`；`u_params.z` 是**环境光接收权重**（0..1） |
| `TextureMaterial` | ✅ Lambert | `(texture × u_color) × lighting` |
| `UnlitColorMaterial` | ❌ | 自发光/UI 用，不受灯光影响 |

灯光通过 `@group(0) @binding(3)` 的 `LightsBlock`（std140）传给 shader；
`BaseMaterial` 已经把它接好（含 `baseBindGroupEntries()`），自定义材质只要在 shader 里
引入 `lightingGLSL()/lightingWGSL()` 片段并调用 `unidrawLighting()` 即可。

> **没有灯的场景不会变黑**：框架使用与历史版本严格等价的默认光
> （环境 0.35 + 方向光 0.65，方向 `-(0.35,0.75,0.55)`），所以旧代码/旧示例观感不变。
> 想要“真正的黑暗”就往场景里放一盏灯再把它 `visible = false`——
> 只要存在灯节点就不会回退默认光。

## 4. 阴影

灯上设 `castShadow = true` 即可投射阴影（方向光/聚光），参数见 `light.shadow`；
每帧需要在主 pass 之前调用 `ShadowRenderer.renderAndSubmit()`（或 `App` 的 `shadows: true`）。
实现细节与排查表见 [shadows.md](shadows.md)。

```ts
const sun = new DirectionalLight(new Vec3(-0.5, -1, -0.4), "#fff3d6", 1.0);
sun.castShadow = true;
sun.shadow.mapSize = 2048;
scene.add(sun);
```

## 5. 性能

- 灯光每帧只收集/打包一次（`collectLights` 遍历一次场景图，零分配），
  每个材质每帧只上传一块 608B 的 UBO；
- 所有 lit 材质共用同一份 `LightsBlock` 布局，因此 WebGL2 后端只分配一组 UBO binding point、
  管线/bind group 也不会因为灯光而分裂；
- shader 内是固定上限的 `for` 循环 + `u_counts` 提前 `break`（比动态长度循环更稳，
  编译器也不会展开成巨量指令）；
- 灯很多时建议：合并同色点光、给点光设 `distance` 缩小影响范围、
  或按需切换 `visible`（示例里 1/2/3/4/0/5 就是干这个的）；
- 阴影会多出「每个投影灯一趟深度 pass」的开销：贴图越大越贵，建议 1024/2048；
  没有阴影时着色器立即返回（`u_shadowMeta.x = 0`），几乎没有额外成本。

## 6. 陷阱

- **方向光的 `direction` 是「光传播的方向」**（从光源射向场景），不是“指向光源”；
  从左上往右下打光写 `(0.35, -0.75, -0.55)`；
- 点光/聚光的位置取节点的**世界位置**，所以必须先 `updateWorldMatrix()`
  （`collectLights()` / `SceneRenderer` 会自动做）；
- 聚光的 `distance` 是**影响距离**，不是“从灯到目标的距离”；
- 关掉所有灯 = 无光照（黑），不是“回到默认光”；默认光只在场景里**没有任何灯节点**时生效；
- 灯的数量超过上限会被静默忽略（可用 `LightsState.overflow` 检查），
  需要更多灯请分批渲染或改用贴图烘焙。
