/**
 * 图层混合模式（以目标为纹理的那 11 种）单元测试。
 *
 * 着色器本身跑不了 CPU 断言（数值一致性靠 `examples/_verify-2d-parity` 的逐像素对照），
 * 这里守住的是**接线**：模式表、`globalCompositeOperation` 不再回退、以及「只有用到
 * 这些模式时才切图层模式」——切错了要么整帧画不出来，要么白白多两张全屏目标。
 */
export {};
//# sourceMappingURL=blend-modes.test.d.ts.map