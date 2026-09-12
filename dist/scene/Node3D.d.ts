import { Mat4 } from "../math/mat4.js";
import { Vec3 } from "../math/vec3.js";
export declare class Node3D {
    readonly id: number;
    name: string;
    visible: boolean;
    readonly children: Node3D[];
    parent: Node3D | null;
    /** 局部变换矩阵（列主序） */
    readonly matrix: Mat4;
    /** 世界变换矩阵（由 updateWorldMatrix 维护） */
    readonly worldMatrix: Mat4;
    /** TRS（写入 matrix 的便捷通道） */
    readonly position: Vec3;
    /** 欧拉角（弧度，顺序 Z→Y→X 内旋，等价矩阵 Rz·Ry·Rx） */
    readonly rotation: Vec3;
    readonly scale: Vec3;
    /** 世界矩阵版本号（变化时自增，供子节点/剔除缓存判断） */
    worldVersion: number;
    /**
     * TRS 是否被显式设置过（脏标记）。
     *
     * 初始为 false：`matrix` 是权威数据源，直接写 `matrix` / `model` 不会被覆盖。
     * 只有调用 setPosition / setRotation / setScale / setTRS / markDirty 之后，
     * 下一次 updateWorldMatrix 才会用 TRS 重新合成 matrix。
     */
    private _dirty;
    private readonly _snapshot;
    private _lastParentVersion;
    constructor();
    /** 兼容旧 API：model 即局部矩阵 */
    get model(): Mat4;
    set model(m: Mat4);
    setPosition(x: number, y: number, z: number): this;
    setRotation(x: number, y: number, z: number): this;
    setScale(x: number, y: number, z: number): this;
    /** 一次写入 TRS（等价 matrix = T·R·S） */
    setTRS(position: Vec3, rotation?: Vec3, scale?: Vec3): this;
    /** 就地改 matrix 后强制标记（一般无需调用，自动检测即可） */
    markDirty(): this;
    add(...nodes: Node3D[]): this;
    remove(...nodes: Node3D[]): this;
    removeFromParent(): this;
    /** 深度优先遍历（含自身） */
    traverse(visit: (node: Node3D) => void): void;
    /** 深度优先遍历（跳过 visible=false 的子树） */
    traverseVisible(visit: (node: Node3D) => void): void;
    /** 局部矩阵是否有变化（TRS 脏标记 或 直接改 matrix 的快照比较） */
    private _updateLocal;
    private _composeFromTRS;
    /**
     * 更新本节点及子节点的世界矩阵。
     * @param force 强制重算整棵子树
     * @param parentWorld 父节点世界矩阵（根节点省略）
     * @param parentWorldVersion 父节点世界矩阵版本
     */
    updateWorldMatrix(force?: boolean, parentWorld?: Mat4, parentWorldVersion?: number): void;
    /** 世界空间位置（需要 worldMatrix 已更新） */
    getWorldPosition(out?: Vec3): Vec3;
    /** 世界矩阵三轴的最大缩放（用于包围球半径/法线校正） */
    getMaxWorldScale(): number;
}
//# sourceMappingURL=Node3D.d.ts.map