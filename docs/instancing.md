# 实例化（InstancedMesh）

> 相关源码：`src/render/InstancedMesh.ts`、`src/render/materialCommon.ts`（实例顶点流）、
> `src/render/shaders/standard.ts`（实例化顶点着色器）
> 示例：`examples/instanced-mesh`（`I` 键在实例化与独立 Mesh 之间切换，逐像素对比一致）

同一个几何体 + 同一个材质画很多份时，用 `InstancedMesh` 可以把它压成**一次 draw**：

```ts
import { InstancedMesh, Geometry, box, Mat4 } from "unidraw";

const mesh = new InstancedMesh(Geometry.create(device, box()), material, 2000);

const m = new Mat4();
for (let i = 0; i < 2000; i++) {
  m.setIdentity().translate(x[i], y[i], z[i]).rotateY(angle[i]);
  mesh.setMatrixAt(i, m);
}
mesh.upload();          // 只上传「脏区间」（首次是全量）
scene.add(mesh);        // SceneRenderer 每帧会自动 upload()（如果还有脏数据）
```

## 1. API

| 成员 | 说明 |
| --- | --- |
| `new InstancedMesh(geometry, material, count, { label })` | `count` = **容量**（实例缓冲一次分配好，之后不能扩容） |
| `instanceCount` | 实际绘制数量（≤ 容量；设为 0 就不画） |
| `setMatrixAt(i, matrix)` / `getMatrixAt(i, out?)` | 写/读第 i 个实例矩阵（列主序 `Mat4`） |
| `setPositionAt(i, x, y, z)` | 只设平移（最常用，比构造矩阵省） |
| `setTRSAt(i, x, y, z, yaw, scale)` | 平移 + 绕 Y 旋转 + 统一缩放 |
| `upload()` | 把脏区间写进顶点缓冲（`SceneRenderer` 每帧自动调用） |
| `instanceBuffer` | 实例矩阵顶点缓冲（绑定到顶点流 slot 1） |
| `capacity` | 容量 |

`mesh.model`（`Node3D` 的局部矩阵）仍然是**整个 InstancedMesh 的基准变换**：
最终顶点 = `u_model × instanceMatrix × position`。

## 2. 实现要点

- 实例矩阵按 `float32x4 × 4`（stride 64B）存在一条 `stepMode: "instance"` 的顶点流上
  （location 3..6）；WebGL2 用 `vertexAttribDivisor`、WebGPU 用 `stepMode: "instance"`，
  两端语义一致（`STANDARD_VERTEX_STATE_INSTANCED`）；
- 内置材质的顶点着色器会自动换成**实例化版本**（`VERTEX_INSTANCED_GLSL`/`VERTEX_INSTANCED_WGSL`）：
  `BaseMaterial` 发现顶点源码等于标准的 `VERTEX_GLSL`/`VERTEX_WGSL` 就替换；
  自定义顶点着色器（例如 ID 材质）通过 `MaterialOptions.instancedVertex` 显式提供；
- 每个材质缓存一条实例化管线（按采样数区分），与普通管线互不干扰；
- 视锥剔除用**所有实例的联合包围球**（`InstancedMesh.updateWorldBounds()` 覆盖了基类）；
- 阴影 pass 与 GPU 颜色拾取也会走实例化路径（阴影用标准顶点着色器 → 自动实例化；
  ID 材质提供了自己的实例化顶点着色器，一个 `InstancedMesh` 拾取为一个可选对象）。

## 3. 退化路径（正确性优先）

材质**没有**实例化顶点着色器时（自定义着色器且未提供 `instancedVertex`），
`SceneRenderer` 会退化成 N 次 `drawGeometry`（用 `world × instanceMatrix`），
画面完全一致，只是没有性能收益。需要自己控制时可以直接判断
`material.drawInstanced` 是否存在。

## 4. 性能建议

- 一次 draw = 一次 `setPipeline` + 一次 `setBindGroup` + 一次 `draw`；
  与之对比，N 个独立 Mesh 是 N 次「管线 + 动态偏移 bind group + 顶点流 + draw」；
- 实例矩阵的修改是 CPU 侧的：只改了一部分实例时，`upload()` 只会写脏区间
  （`setMatrixAt` 会记录最小/最大脏下标）；
- 静态实例（只上传一次）没有额外每帧成本；每帧全量改 10 万个实例反而是 CPU 瓶颈
  （此时考虑把动画放进顶点着色器或用计算着色器，当前版本未提供）；
- 需要**不同几何体**时实例化帮不上忙（同一次绘制只能有一个几何体）；
  可以用材质数组 / 多次 `InstancedMesh`。

## 5. 验证

`examples/instanced-mesh` 的 `INSTANCED_SELFTEST` 会把同一场景用两种方式各渲染一帧、
逐像素比较：

```json
{"backend":"webgpu","instances":256,"drawsInstanced":1,"drawsIndividual":256,
 "meanDiff":0,"maxDiff":0,"differingRatio":0,"matchOk":true}
```

`meanDiff = 0` 说明实例化路径与「N 个独立 Mesh」在 WebGL2/WebGPU 上都**逐像素一致**，
而 draw 次数从 256 降到 1。
