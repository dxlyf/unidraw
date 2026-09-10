# 动画（关键帧 · Mixer · Tween）

模块：`src/animation`；示例：`examples/animation`。

三种做法，按需求选择：

| 方式 | 适合 | 入口 |
| --- | --- | --- |
| 关键帧轨道 | 复杂曲线、美术导出的时间轴、需要精确控制每一段缓动 | `KeyframeTrack` / `numberTrack` / `vec3Track` / `colorTrack` |
| 片段 + 播放器 | 可复用的动作（走/跑/旋转）、需要循环/时间缩放/淡入淡出 | `AnimationClip` + `AnimationMixer` + `AnimationAction` |
| Tween | 代码里的一次性动效（弹出、呼吸、过渡） | `tweenNumber` / `tweenVec3` / `tweenColor` / `tweenObject` + `TweenManager` |

---

## 1. 关键帧轨道

一条轨道 = **关键帧数组** + **值类型**（怎么插值）+ **写回目标**（自定义绑定）。

```ts
import { nodePositionTrack, numberTrack, colorKeys, materialColorTrack, vec3Keys } from "unidraw";

// 位置：写回 Node3D（内部调用 setPosition → 正确触发脏标记）
const pos = nodePositionTrack(mesh, vec3Keys([
  { time: 0,   value: [0, 0, 0], easing: "quadOut" },
  { time: 0.5, value: [0, 2, 0], easing: "quadIn" },
  { time: 1,   value: [0, 0, 0] },
  { time: 2,   value: [0, 0, 0] },   // 尾部停留
]));

// 标量：自定义绑定（任意对象）
const alpha = numberTrack((v) => { panel.opacity = v; }, [
  { time: 0, value: 0 },
  { time: 1, value: 1 },
]);

// 颜色：材质
const tint = materialColorTrack(material, colorKeys([
  { time: 0, value: "#22d3ee" },
  { time: 1, value: "#ff5c8a", easing: "smooth" },
]));
```

求值规则（`sample` / `apply`）：

- `time <= 首帧` → 首帧值；`time >= 末帧` → 末帧值（**不外推**）；
- 段内用**左端关键帧**的 `easing` / `interpolation`（`"step"` 表示保持左值）；
- `apply(time, weight)`：`weight < 1` 时与**上一次写回的值**混合 —— 这就是淡入淡出的基础；
- 内部复用暂存值，`apply()` 每帧调用不产生垃圾；顺序播放有段游标缓存。

自定义绑定就是普通函数 `(value) => void`，所以轨道可以驱动任何东西：

```ts
const track = new KeyframeTrack<number>({
  keys: [{ time: 0, value: 0 }, { time: 1, value: 4 }],
  type: NumberTrackType,
  write: (v) => shaderParams.blur = v,
});
```

`src/animation/bindings.ts` 提供了常用绑定：`bindNodePosition / bindNodeRotation /
bindNodeScale / bindObjectColor / bindProperty`，以及对应的 `nodePositionTrack` 等便捷构造。

---

## 2. 片段与播放器（AnimationClip + Mixer）

```ts
const mixer = new AnimationMixer(scene);

const walk = new AnimationClip("walk", { duration: 4 })
  .addTrack(nodePositionTrack(bob, bobKeys))
  .addTrack(nodeScaleTrack(bob, squashKeys));

const paint = new AnimationClip("paint").addTrack(materialColorTrack(mat, colorKeys(...)));

const action = mixer.play(walk, { loop: "repeat", weight: 1 });
mixer.play(paint, { loop: "ping-pong" });

// 每帧
mixer.update(dt);            // 内部 × mixer.timeScale
```

`AnimationAction` 的能力：

- 循环：`loop: "once" | "repeat" | "ping-pong"` + `repetitions`（`Infinity` 无限）；
- 时间：`time` / `progress` / `seek(t)` / `restart()`、`timeScale`（负值倒放）、
  `direction`（ping-pong 自动翻转）；
- 权重：`weight`、`fadeIn(sec)` / `fadeOut(sec)`（按真实时间推进，不受 timeScale 影响）；
- 回调：`onFinished(cb)`（`"once"` 与有限次循环结束时触发）；
- `clampWhenFinished` 决定结束后停在末帧还是回到起点。

`AnimationMixer`：`timeScale`（全局速度/暂停）、`clip()`（同 Clip 复用同一 Action）、
`play()` / `stopAll()` / `setPaused()` / `remove()` / `running` / `activeClipNames`。

> 未被播放的 Action 不会写回属性，所以停在最后写入的姿态；
> 需要并行播放同一 Clip 时，用多个 Mixer（例如“上半身/下半身”分离）。

---

## 3. Tween（不必写关键帧）

```ts
const tweens = new TweenManager();

// 数值（呼吸灯：无限往返）
tweens.add(tweenNumber(0, 1, 1.6, (v) => lamp.setIntensity(0.6 + v), {
  easing: "sineInOut", repeat: Infinity, yoyo: true,
}));

// Vec3（弹出位移）
tweens.add(tweenVec3(from, to, 0.28, (v) => mesh.setPosition(v.x, v.y, v.z), {
  easing: "backOut", yoyo: true, repeat: 1,
}));

// 对象数值属性（缩放弹出；Node3D 的 TRS 需要 markDirty）
tweens.add(tweenObject(mesh.scale, { x: 1.7, y: 1.7, z: 1.7 }, 0.16, {
  easing: "quadOut", yoyo: true, repeat: 1, markDirty: true,
}));

// 每帧
tweens.update(dt);   // 完成的 Tween 自动移除
```

`Tween` 支持 `duration / delay / repeat / yoyo / easing`、`onUpdate / onRepeat / onComplete`、
`play / stop / reset / seek / progress / value`。

---

## 4. 缓动（`Easing`）

`linear`、`smooth`、`quadIn/Out/InOut`、`cubicIn/Out/InOut`、`quartIn/Out/InOut`、
`sineIn/Out/InOut`、`expoIn/Out/InOut`、`backIn/Out/InOut`、`elasticOut`、`step`。

名字字符串或函数都可直接用：`{ time: 0, value: 0, easing: "backOut" }` 或
`withEasing((t) => t * t)`。`back*` / `elasticOut` 会短暂越界（回弹手感）。

---

## 5. 与场景图 / 拾取 / App 的配合

- 轨道写回 Node3D 时请用 `setPosition/setRotation/setScale`（或 `markDirty()`），
  这样世界矩阵的脏标记链路才会生效；
- `examples/animation` 里点击物体 → `ColorPicker` 拾取 → 用 Tween 弹出该物体：
  层级动画 + 拾取 + 补间可以叠加使用；
- 下一节的 `App`（`src/app`）会把 `mixer.update(dt)` 与 `tweens.update(dt)`
  统一放进主循环，业务代码只需要写 `app.frame()`。

---

## 6. 陷阱

- `KeyframeTrack` 的段缓动取**左端**关键帧（与 Three.js 一致），
  写在右端不会生效；
- 关键帧时间不必按顺序书写，构造时会排序，但**不要重复时间点**（后面的会覆盖前面的段）；
- `Tween` 的 `repeat` 是「额外重复次数」：`repeat: 1` = 播放两轮；
- `yoyo` 只在多轮时才有意义（第二轮反向）；
- 组件/页面销毁时记得 `mixer.dispose()` / `tweens.stopAll()`，
  并在需要时 `input.dispose()`（`App` 门面会统一处理）。
