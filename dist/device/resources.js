/**
 * 设备层资源句柄的统一出口（barrel）。
 *
 * 实现已按「一个类一个文件」拆分到 `./resource/*`；本文件保持原有导入路径
 * （`device/resources.js`）向后兼容。
 */
export * from "./resource/ResourceBase.js";
export * from "./resource/Buffer.js";
export * from "./resource/Texture.js";
export * from "./resource/TextureView.js";
export * from "./resource/Sampler.js";
export * from "./resource/Program.js";
export * from "./resource/BindGroupLayout.js";
export * from "./resource/BindGroup.js";
export * from "./resource/RenderPipeline.js";
//# sourceMappingURL=resources.js.map