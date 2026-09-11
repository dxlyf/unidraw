# 示例游戏《坦克世界》

> 源码：`examples/tank-world/`（`main.ts` 玩法与自检、`tank.ts` 坦克、`arena.ts` 战场与碰撞、`effects.ts` 特效与炮弹）
> 在线：`dist-examples/tank-world/index.html`（`?backend=webgl2|webgpu` 切换后端）

这是一个**把框架能力串起来**的完整小游戏：不是"能跑就行"的涂鸦，而是有输入、AI、
碰撞、炮弹、伤害、计分、特效、阴影与后处理的闭环 demo（约 800 行示例代码）。

## 1. 玩法

| 操作 | 作用 |
| --- | --- |
| **W / S** | 前进 / 倒车 |
| **A / D** | 车体转向 |
| **鼠标** | 瞄准：把炮塔转向"指针射线与地面的交点" |
| **空格 / 左键** | 开火（有装填时间，炮口闪光 + 后坐） |
| **Shift** | 慢动作（时间缩放） |
| **R** | 重开一局 |
| **滚轮** | 视角远近 |

敌人 AI：巡逻 → 发现玩家（34 单位内）→ 保持 12~20 距离并开火；
被击毁 4 秒后复活；玩家被击毁 2.5 秒后复活（示例不做失败流程）。

## 2. 用了框架的什么

| 能力 | 在游戏里的体现 |
| --- | --- |
| 场景图 | 车体 → 炮塔 → 炮管 → 炮口 的四层节点，炮塔独立于车体旋转 |
| `SceneRenderer` | 视锥剔除（`frustumCulled`）、不透明/半透明排序、`stats` 直接显示在 HUD |
| `PhongMaterial` | 车体/炮塔/履带/掩体/地面（不同 shininess/specular/ambient） |
| `UnlitColorMaterial` + `blend` | 枪口闪光/爆炸/炮弹 = 叠加发光；烟雾 = 普通 alpha 混合（自动排在最后） |
| `ShadowRenderer` | 方向光给全体坦克与掩体投影（PCF 软阴影，GUI 可关掉对比） |
| `EffectComposer` | 泛光（让爆炸发光）+ ACES 色调映射 + 暗角；GUI 可整体/逐项开关 |
| `InputManager` | 键鼠输入、NDC 指针；`Raycaster` 把指针变成地面瞄准点 |
| `Camera` | 第三人称跟随（平滑 + 镜头抖动），`freeLook` 时不跟车体 |
| `RenderTarget` | 自检时离屏渲染并回读像素（含开/关阴影两帧对比） |
| lil-gui | 右上角参数面板：敌人数、速度、伤害、装填、精度、慢动作、阴影/MSAA/后处理、相机 |

## 3. 结构

```
examples/tank-world/
  main.ts      启动、输入、AI、命中处理、相机、HUD、lil-gui、TANK_SELFTEST
  tank.ts      Tank：车体/炮塔/炮管/血条 + 移动/瞄准/装填/受伤/复活
  arena.ts     Arena：地面 + 掩体布局，圆 vs AABB 碰撞、射线 vs 盒子、可复现随机数
  effects.ts   EffectPool（billboard 特效池）+ ProjectilePool（炮弹 + 连续碰撞）
```

设计上刻意把**游戏逻辑**（`stepGame`）与**渲染**分开：
`stepGame(dt, input)` 不读键盘、不读相机，输入通过 `TankInput` 传入 —— 因此自检可以
注入脚本输入做确定性模拟（同一份代码既跑游戏也跑测试）。

## 4. 自检（`TANK_SELFTEST`）

`?selftest=1`（默认）会在第 25 帧做一次确定性模拟：

1. 固定步长 `1/60` 注入脚本输入：先前进 1 秒，再瞄准敌人持续开火 4 秒；
2. 断言：`moved ≈ 14`（移动生效）、`shots/kills/hits`（开火与命中）、
   `enemyHpDrop`（伤害）、`enemyShots`（AI 反击）、`maxShells/maxEffects`（特效池在工作）、
   `meanLuma`（渲染有内容）、`shadowDiff`（开/关阴影画面确实不同）；
3. 打印 `TANK_SELFTEST {...}`，WebGL2 与 WebGPU 数值一致（可直接对比）：

```json
{"backend":"webgpu","moved":14,"shots":4,"hits":3,"kills":1,"enemyHpDrop":68,
 "enemyShots":3,"playerHp":58,"maxShells":2,"maxEffects":8,
 "meanLuma":0.1689,"shadowDiff":0.0036,
 "moveOk":true,"fireOk":true,"hitOk":true,"killOk":true,"aiOk":true,
 "effectOk":true,"renderOk":true,"shadowOk":true}
```

`?layout=random` 会让掩体随机生成（默认固定布局，保证自检可复现）；
`?gui=0` 关掉参数面板（无头截图用）。

## 5. 想继续扩展的方向

- 地形高度（现在地面是平的）、斜坡上的车身俯仰；
- 履带印/弹坑贴花（`EffectPool` 里已按池化思路写好，加一类即可）；
- 更真实的 AI（视线检测 + 掩体利用）、小队配合；
- 用 `InstancedMesh` 画大量树/石块等静态装饰（当前掩体是独立 Mesh）；
- 网络对战（统一命令流 + CommandBuffer 可序列化，理论上可作为回放/同步的基础）。
