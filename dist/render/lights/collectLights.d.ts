/**
 * 从场景图收集灯光并打包（每帧一次遍历，零分配）。
 */
import type { Node3D } from "../../scene/Node3D.js";
import { LightsState } from "./LightsState.js";
export interface CollectLightsOptions {
    /** 没有任何灯时是否写入默认光（默认 true：保持「不加灯也有光」的历史观感） */
    fallbackToDefault?: boolean;
}
export interface CollectLightsResult {
    /** 打包结果（复用缓冲，下一次调用即失效） */
    state: LightsState;
    /** 场景里的灯节点总数（含 visible=false 的） */
    present: number;
    /** 参与打包（visible）的灯数量 */
    count: number;
    /** 被忽略的灯数量（超出单着色器上限） */
    skipped: number;
    /** 是否使用了默认光（场景里**没有任何灯节点**时才用） */
    usedDefault: boolean;
}
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
export declare function collectLights(root: Node3D, state: LightsState, options?: CollectLightsOptions): CollectLightsResult;
//# sourceMappingURL=collectLights.d.ts.map