/**
 * InstancedMesh —— 一次绘制画 N 个实例（同一几何体 + 同一材质）。
 *
 * ```ts
 * const instanced = new InstancedMesh(Geometry.create(device, box()), material, 1000);
 * const m = new Mat4();
 * for (let i = 0; i < 1000; i++) {
 *   m.setIdentity().translate(Math.random() * 20 - 10, 0, Math.random() * 20 - 10);
 *   instanced.setMatrixAt(i, m);
 * }
 * instanced.upload();            // 一次性上传实例矩阵（之后只改了某几个再调用即可）
 * scene.add(instanced);
 * ```
 *
 * 关键点：
 * - **一个 draw**：`pass.draw(vertexCount, instanceCount)`，CPU 侧不再有 per-instance 命令；
 * - 实例矩阵走 `stepMode: "instance"` 的顶点流（location 3..6，stride 64），
 *   WebGL2 用 `vertexAttribDivisor`、WebGPU 用 `stepMode: "instance"`，两端语义一致；
 * - `model`（局部矩阵）是**整个 InstancedMesh 的基准变换**，实例矩阵叠加在它之上；
 * - 视锥剔除用所有实例的联合包围球（`updateWorldBounds` 覆盖）；
 * - 材质没提供实例化顶点着色器时，`SceneRenderer` 会退化成 N 次普通绘制（保证正确性）。
 */
import type { Buffer } from "../device/resources.js";
import { Mat4 } from "../math/mat4.js";
import { Geometry } from "./Geometry.js";
import { Mesh } from "./Mesh.js";
import type { MaterialLike } from "../scene/types.js";
export interface InstancedMeshOptions {
    label?: string;
    /**
     * 实例矩阵是否经常变化（默认 true）。
     *
     * 只是给未来「静态实例用更省的 buffer 用法」留的开关，目前两种取值都使用
     * `VERTEX | COPY_DST`，行为一致。
     */
    dynamic?: boolean;
}
export declare class InstancedMesh extends Mesh {
    /** 实例容量（构造时确定；`instanceCount` 不能超过它） */
    readonly capacity: number;
    /** 实例矩阵顶点缓冲（绑定到顶点流 slot 1） */
    readonly instanceBuffer: Buffer;
    private _count;
    private readonly _data;
    /** 联合包围球计算的复用缓冲（每实例 3 个分量） */
    private readonly _centers;
    private readonly _scratch;
    private readonly _localCenter;
    private _localRadius;
    /** 实例数据版本（影响包围球与需要上传的区间） */
    private _instanceVersion;
    private _boundsInstanceVersion;
    /** 待上传区间（[start, end) 个实例；start > end 表示没有待上传内容） */
    private _dirtyStart;
    private _dirtyEnd;
    constructor(geometry: Geometry, material: MaterialLike | null, count?: number, options?: InstancedMeshOptions);
    /** 实际绘制的实例数（可以小于 capacity） */
    get instanceCount(): number;
    set instanceCount(count: number);
    /** 写入第 `index` 个实例的矩阵（记得 `upload()`） */
    setMatrixAt(index: number, matrix: Mat4): this;
    /** 读取第 `index` 个实例的矩阵 */
    getMatrixAt(index: number, out?: Mat4): Mat4;
    /** 便捷：只设平移（最常用；比构造 Mat4 更省） */
    setPositionAt(index: number, x: number, y: number, z: number): this;
    /** 便捷：平移 + 绕 Y 旋转 + 统一缩放 */
    setTRSAt(index: number, x: number, y: number, z: number, yaw?: number, scale?: number): this;
    /** 把待上传的实例矩阵写到 GPU（`SceneRenderer` 每帧自动调用；手动渲染时自己调） */
    upload(): void;
    /** 是否有待上传的实例矩阵 */
    get hasPendingUpload(): boolean;
    updateWorldBounds(force?: boolean): void;
    /** 所有实例的联合包围球（局部空间，近似：球心均值 + 最大外扩半径） */
    private _computeInstanceBounds;
    private _markDirty;
    private _writeIdentity;
    private _assertIndex;
}
//# sourceMappingURL=InstancedMesh.d.ts.map