export const version = "0.1.0";

// ---- 数学 ----------------------------------------------------------------
export * from "./math/index.js";

// ---- 统一 GPU 类型 / 格式 / std140 ----------------------------------------
export * from "./gpu/types.js";
export * from "./gpu/formats.js";
export * from "./gpu/std140.js";

// ---- 设备与资源抽象 ---------------------------------------------------------
export * from "./device/Device.js";
export * from "./device/descriptors.js";
export * from "./device/resources.js";
export * from "./device/createDevice.js";

// ---- 统一命令 ---------------------------------------------------------------
export * from "./command/ops.js";
export * from "./command/encoder.js";

// ---- 后端 --------------------------------------------------------------------
export * from "./device/backend/mock/MockDevice.js";
export * from "./device/backend/webgl2/WebGL2Device.js";
export * from "./device/backend/webgpu/WebGPUDevice.js";

// ---- 渲染层 -----------------------------------------------------------------
export * from "./render/Geometry.js";
export * from "./render/primitives.js";
export * from "./render/UniformBlock.js";
export * from "./render/material.js";
export * from "./render/lights/index.js";
export * from "./render/RenderTarget.js";
export * from "./render/postfx/index.js";
export * from "./render/shadow/index.js";
export * from "./render/Mesh.js";
export * from "./render/blendModes.js";
export * from "./render/InstancedMesh.js";
export * from "./render/texture.js";
export * from "./render/Camera.js";
export * from "./render/shaders.js";
export * from "./render/Renderer.js";

// ---- 2D 渲染层 ---------------------------------------------------------------
export * from "./render2d/index.js";

// ---- 场景图 / 交互 / 拾取 -----------------------------------------------------
export * from "./scene/index.js";
export * from "./interaction/index.js";
export * from "./picking/index.js";

// ---- 动画 -------------------------------------------------------------------
export * from "./animation/index.js";

// ---- 应用门面与插件 -----------------------------------------------------------
export * from "./app/index.js";

// ---- 开源工具（回读等） -------------------------------------------------------
export * from "./device/readback.js";

// ---- 工具 -------------------------------------------------------------------
export * from "./util/assert.js";
export * from "./util/logger.js";
