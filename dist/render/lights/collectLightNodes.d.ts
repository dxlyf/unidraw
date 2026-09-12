/**
 * 按「与 `collectLights()` 完全相同的遍历顺序」取出场景里的**可见**灯节点。
 *
 * 阴影渲染需要知道每盏灯在打包灯光数组里的序号（着色器按「类型 + 序号」匹配
 * 阴影贴图），这个序号必须与 `LightsState.addDirectional/addSpot` 的写入顺序一致，
 * 因此这里复用同一套遍历规则（深度优先、灯节点不再向下递归、跳过 invisible）。
 */
import type { Node3D } from "../../scene/Node3D.js";
import { Light } from "./Light.js";
/**
 * 收集可见灯节点（写入 `out`，复用数组避免逐帧分配）。
 *
 * @returns 收集到的数量（`out.length` 会被设为该值）
 */
export declare function collectLightNodes(root: Node3D, out: Light[]): number;
//# sourceMappingURL=collectLightNodes.d.ts.map