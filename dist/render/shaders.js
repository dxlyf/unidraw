/**
 * 内置着色器源码的统一出口（barrel）。
 *
 * 实现已按「材质一份」拆分到 `./shaders/*`；本文件保持原有导入路径
 * （`render/shaders.js`）向后兼容。
 */
export * from "./shaders/standard.js";
export * from "./shaders/color.js";
export * from "./shaders/texture.js";
export * from "./shaders/unlit.js";
export * from "./shaders/phong.js";
export * from "./shaders/blit.js";
//# sourceMappingURL=shaders.js.map