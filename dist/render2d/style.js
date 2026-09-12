/**
 * 2D 填充样式（颜色 / 渐变）的统一出口（barrel）。
 *
 * 实现已拆分到同目录：`color.ts`（RGBA/hex）、`LinearGradient.ts`、`RadialGradient.ts`、
 * `paint.ts`（采样逻辑）；本文件保持原有导入路径（`render2d/style.js`）向后兼容。
 */
export * from "./color.js";
export * from "./LinearGradient.js";
export * from "./RadialGradient.js";
export * from "./paint.js";
//# sourceMappingURL=style.js.map