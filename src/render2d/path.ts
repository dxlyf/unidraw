/**
 * 2D 路径（Path2D）的统一出口（barrel）。
 *
 * 实现已拆分到同目录：`pathTypes.ts`（PathOp/Contour/曲线细分工具）、`Path2D.ts`
 * （路径构建与轮廓提取）；本文件保持原有导入路径（`render2d/path.js`）向后兼容。
 */

export * from "./pathTypes.js";
export * from "./Path2D.js";
