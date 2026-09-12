/**
 * 场景图 / 射线拾取 / 颜色拾取（Mock 后端）单元测试。
 *
 * Mock 后端不做真实光栅化，因此这里断言的是：
 * - 场景图世界矩阵与视锥剔除/排序行为；
 * - 射线拾取的几何正确性（距离、命中面、未命中）；
 * - ColorPicker 的命令结构（可见物体数 = ID pass 的 draw 数）、像素映射、
 *   背景未命中、resize/dispose 生命周期；
 * - ID 颜色编解码的往返一致性。
 * 真实像素级一致性由 `examples/picking` 的无头自检覆盖（双后端 40/40 一致）。
 */
export {};
//# sourceMappingURL=picking.test.d.ts.map