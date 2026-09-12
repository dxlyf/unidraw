/**
 * 3D 数学工具类的单元测试（对齐 three.js 的 math 模块）。
 *
 * 覆盖重点不是「方法能调用」，而是**恒等式与边界情况**：
 * - 旋转表示之间的往返（Euler ↔ Quaternion ↔ Mat4）必须闭合；
 * - `setFromUnitVectors` 的反向共线（180°）特例；
 * - 平面/AABB/球的相交判据在「明显在内 / 明显在外 / 恰好相切」三档上的行为；
 * - 退化输入（零长线段、退化三角形、极点）不产生 NaN。
 */
export {};
//# sourceMappingURL=math3d.test.d.ts.map