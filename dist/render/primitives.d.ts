/**
 * 内置几何体（primitives）的统一出口（barrel）。
 *
 * 实现已按「一个几何体一个文件」拆分到 `./primitives/*`；本文件保持原有导入路径
 * （`render/primitives.js`）向后兼容。
 */
export * from "./primitives/types.js";
export * from "./primitives/quad.js";
export * from "./primitives/box.js";
export * from "./primitives/plane.js";
export * from "./primitives/sphere.js";
export * from "./primitives/triangle.js";
export * from "./primitives/lathe.js";
export * from "./primitives/cylinder.js";
export * from "./primitives/torus.js";
export * from "./primitives/capsule.js";
//# sourceMappingURL=primitives.d.ts.map