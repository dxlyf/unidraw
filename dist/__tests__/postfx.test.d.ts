/**
 * 后处理单元测试：RenderTarget / EffectComposer / 呈现 blit / MSAA 降级。
 *
 * Mock 后端不栅格化，但会**校验管线与附件的颜色格式是否匹配**（`setPipeline` 时），
 * 并记录每个 pass 的 draw —— 因此可以精确断言：
 * - 效果链的 ping-pong 顺序与输入纹理；
 * - 「链内永远是链路格式，最后由一趟按输出格式创建的拷贝 pass 呈现」这条规则
 *   （画布格式与链路格式不同时也能通过校验）。
 */
export {};
//# sourceMappingURL=postfx.test.d.ts.map