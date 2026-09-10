/**
 * 阴影模块（Shadow Map）。
 *
 * | 导出 | 作用 |
 * | --- | --- |
 * | `ShadowRenderer` | 每帧渲染投影灯（方向光/聚光）的阴影贴图 |
 * | `ShadowSettings` | 单灯参数（`light.shadow`） |
 * | `ShadowMap` | 一张深度贴图 + 光源视投影矩阵 |
 * | `ShadowCamera` | 光源视投影矩阵拟合（正交/透视，含纹素对齐） |
 * | `ShadowState` | 打包进 `ShadowBlock` 的 CPU 数据（贴图矩阵/偏移/序号） |
 * | `ShadowDepthMaterial` | 只写深度的材质（正面剔除） |
 * | `shadowResources` | 全设备共享的阴影 UBO / 贴图池 / 占位纹理 |
 *
 * 快速上手：
 * ```ts
 * const sun = new DirectionalLight(new Vec3(-0.4, -1, -0.3), "#fff3d6", 1.1);
 * sun.castShadow = true;
 * scene.add(sun);
 *
 * const shadows = new ShadowRenderer(device);
 * // 每帧（阴影 pass 必须在画布 pass 之前记录到同一个 encoder）
 * shadows.render(encoder, scene, camera, sceneRenderer);
 * ```
 *
 * 详见 docs/shadows.md。
 */

export * from "./ShadowSettings.js";
export * from "./ShadowMap.js";
export * from "./ShadowState.js";
export * from "./ShadowCamera.js";
export * from "./ShadowDepthMaterial.js";
export * from "./ShadowRenderer.js";
export * from "./ShadowResources.js";
export * from "./shadowShaders.js";
export * from "./constants.js";
