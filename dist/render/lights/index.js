/**
 * 灯光模块：环境光 / 方向光（平行光）/ 点光 / 聚光 + **阴影**。
 * - 灯是场景图节点（继承 `Node3D`），可以挂在任意父节点下、被动画驱动；
 * - 每帧由 `SceneRenderer` 调用 `collectLights()` 打包进 `LightsBlock`（std140）；
 * - 内置材质（`ColorMaterial` / `PhongMaterial` / `TextureMaterial`）自动使用该数据；
 *   场景里**没有任何灯**时使用与历史版本等价的默认光（环境 0.35 + 方向光 0.65）；
 * - 阴影：`light.castShadow = true` + `ShadowRenderer`（见 `render/shadow`）。
 *
 * 详细用法见 docs/lighting.md 与 docs/shadows.md。
 */
export * from "./Light.js";
export * from "./AmbientLight.js";
export * from "./DirectionalLight.js";
export * from "./PointLight.js";
export * from "./SpotLight.js";
export * from "./LightsState.js";
export * from "./collectLights.js";
export * from "./collectLightNodes.js";
//# sourceMappingURL=index.js.map