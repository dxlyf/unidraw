/**
 * 拾取（picking）模块。
 *
 * - 几何拾取：`Ray` / `Raycaster`（见 interaction/）—— CPU 端包围球→AABB→三角形；
 * - GPU 颜色拾取：`ColorPicker` + `IdMaterial` —— 离屏 ID pass + 像素回读，逐像素精确。
 */

export * from "./IdMaterial.js";
export * from "./ColorPicker.js";
