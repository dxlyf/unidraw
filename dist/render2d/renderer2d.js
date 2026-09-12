/**
 * 2D 立即模式渲染器（Canvas2D）的统一出口（barrel）。
 *
 * 实现已拆分到同目录：`types.ts`（选项/状态类型）、`Canvas2D.ts`（渲染器主体）、
 * `geometry2d.ts`（线段/矩形求交等几何辅助）；本文件保持原有导入路径
 * （`render2d/renderer2d.js`）向后兼容。
 */
export * from "./types.js";
export * from "./Canvas2D.js";
export * from "./geometry2d.js";
//# sourceMappingURL=renderer2d.js.map