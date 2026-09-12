/**
 * 从场景图收集灯光并打包（每帧一次遍历，零分配）。
 */
import { Light } from "./Light.js";
/**
 * 遍历 `root` 收集所有 `Light` 节点并打包。
 *
 * 语义：
 * - 只有 `visible !== false` 的灯参与光照；
 * - 场景里**完全没有灯节点**时写入默认光（保持「不加灯也有光」的历史观感）；
 *   但如果场景里有灯却全部被隐藏，则结果是「无光照」（全黑），符合直觉。
 *
 * 会先调用 `root.updateWorldMatrix()`（保证点光/聚光的世界位置正确）。
 */
export function collectLights(root, state, options = {}) {
    root.updateWorldMatrix();
    state.reset();
    let present = 0;
    let count = 0;
    const visit = (node) => {
        if (node instanceof Light) {
            present++;
            if (node.visible) {
                count++;
                node.contribute(state);
            }
            // 灯自身不再往下递归（避免误收集嵌套灯）
            return;
        }
        const children = node.children;
        for (let i = 0; i < children.length; i++)
            visit(children[i]);
    };
    visit(root);
    state.finish();
    let usedDefault = false;
    if (present === 0 && options.fallbackToDefault !== false) {
        state.fillDefault();
        usedDefault = true;
    }
    return { state, present, count, skipped: state.overflow, usedDefault };
}
//# sourceMappingURL=collectLights.js.map