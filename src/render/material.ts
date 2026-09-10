// 材质模块统一入口（保持 `render/material.js` 的导入路径稳定）。
// 具体实现按「一个文件一个类」拆分在同目录下：
//   BaseMaterial / ColorMaterial / UnlitColorMaterial / PhongMaterial / TextureMaterial
// 共享的 uniform 布局与管线描述放在 materialCommon.ts（内部实现，不对外导出）。
export * from "./BaseMaterial.js";
export * from "./ColorMaterial.js";
export * from "./UnlitColorMaterial.js";
export * from "./PhongMaterial.js";
export * from "./TextureMaterial.js";
