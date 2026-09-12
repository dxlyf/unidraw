/**
 * 拾取相关的回归测试（针对用户反馈的两个缺陷）：
 *
 * 1. `ColorPicker.pick()` 必须**每次重绘 ID pass** ——
 *    此前只在首次（`dirty`）时重绘，相机一转就复用过期目标，
 *    表现为「选中/高亮到错误物体，且射线看起来更准」；
 * 2. `HighlightPlugin` 的材质接管必须精确恢复，且选中与悬停可同时高亮 ——
 *    此前用单个 `_restore` 槽，移开鼠标会清掉选中项的高亮 / 恢复错对象。
 */
export {};
//# sourceMappingURL=picking-regression.test.d.ts.map