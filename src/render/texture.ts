/**
 * 纹理工具函数的统一出口（barrel）。
 *
 * 实现已按用途拆分到 `./texture/*`（rgba / checker / image）；本文件保持原有导入路径
 * （`render/texture.js`）向后兼容。
 */

export * from "./texture/rgba.js";
export * from "./texture/checker.js";
export * from "./texture/image.js";
