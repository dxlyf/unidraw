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
import { BufferUsage } from "../gpu/types.js";
import { Mat4 } from "../math/mat4.js";
import { Vec3 } from "../math/vec3.js";
import { assert } from "../util/assert.js";
import { Mesh } from "./Mesh.js";
/** 每个实例 16 个 float（列主序矩阵） */
const FLOATS_PER_INSTANCE = 16;
export class InstancedMesh extends Mesh {
    /** 实例容量（构造时确定；`instanceCount` 不能超过它） */
    capacity;
    /** 实例矩阵顶点缓冲（绑定到顶点流 slot 1） */
    instanceBuffer;
    _count;
    _data;
    /** 联合包围球计算的复用缓冲（每实例 3 个分量） */
    _centers;
    _scratch = new Mat4();
    _localCenter = new Vec3();
    _localRadius = 0;
    /** 实例数据版本（影响包围球与需要上传的区间） */
    _instanceVersion = 0;
    _boundsInstanceVersion = -1;
    /** 待上传区间（[start, end) 个实例；start > end 表示没有待上传内容） */
    _dirtyStart = 0;
    _dirtyEnd = 0;
    constructor(geometry, material, count = 1, options = {}) {
        super(geometry, material);
        const capacity = Math.max(1, Math.floor(count));
        this.capacity = capacity;
        this._count = capacity;
        this._data = new Float32Array(capacity * FLOATS_PER_INSTANCE);
        for (let i = 0; i < capacity; i++)
            this._writeIdentity(i);
        this._centers = new Float32Array(capacity * 3);
        this.instanceBuffer = geometry.device.createBuffer({
            label: `${options.label ?? "instanced-mesh"}-instances`,
            size: capacity * FLOATS_PER_INSTANCE * 4,
            usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
        });
        this.name = options.label ?? "InstancedMesh";
        // 初始为单位矩阵，需要完整上传一次
        this._dirtyStart = 0;
        this._dirtyEnd = capacity;
    }
    /** 实际绘制的实例数（可以小于 capacity） */
    get instanceCount() {
        return this._count;
    }
    set instanceCount(count) {
        const next = Math.max(0, Math.min(this.capacity, Math.floor(count)));
        if (next === this._count)
            return;
        this._count = next;
        this._instanceVersion++;
    }
    /** 写入第 `index` 个实例的矩阵（记得 `upload()`） */
    setMatrixAt(index, matrix) {
        this._assertIndex(index);
        matrix.writeTo(this._data, index * FLOATS_PER_INSTANCE * 4);
        this._markDirty(index);
        return this;
    }
    /** 读取第 `index` 个实例的矩阵 */
    getMatrixAt(index, out = new Mat4()) {
        this._assertIndex(index);
        out.elements.set(this._data.subarray(index * FLOATS_PER_INSTANCE, (index + 1) * FLOATS_PER_INSTANCE));
        return out;
    }
    /** 便捷：只设平移（最常用；比构造 Mat4 更省） */
    setPositionAt(index, x, y, z) {
        this._assertIndex(index);
        const base = index * FLOATS_PER_INSTANCE;
        const d = this._data;
        d[base] = 1;
        d[base + 1] = 0;
        d[base + 2] = 0;
        d[base + 3] = 0;
        d[base + 4] = 0;
        d[base + 5] = 1;
        d[base + 6] = 0;
        d[base + 7] = 0;
        d[base + 8] = 0;
        d[base + 9] = 0;
        d[base + 10] = 1;
        d[base + 11] = 0;
        d[base + 12] = x;
        d[base + 13] = y;
        d[base + 14] = z;
        d[base + 15] = 1;
        this._markDirty(index);
        return this;
    }
    /** 便捷：平移 + 绕 Y 旋转 + 统一缩放 */
    setTRSAt(index, x, y, z, yaw = 0, scale = 1) {
        this._assertIndex(index);
        const c = Math.cos(yaw) * scale;
        const s = Math.sin(yaw) * scale;
        const base = index * FLOATS_PER_INSTANCE;
        const d = this._data;
        d[base] = c;
        d[base + 1] = 0;
        d[base + 2] = -s;
        d[base + 3] = 0;
        d[base + 4] = 0;
        d[base + 5] = scale;
        d[base + 6] = 0;
        d[base + 7] = 0;
        d[base + 8] = s;
        d[base + 9] = 0;
        d[base + 10] = c;
        d[base + 11] = 0;
        d[base + 12] = x;
        d[base + 13] = y;
        d[base + 14] = z;
        d[base + 15] = 1;
        this._markDirty(index);
        return this;
    }
    /** 把待上传的实例矩阵写到 GPU（`SceneRenderer` 每帧自动调用；手动渲染时自己调） */
    upload() {
        if (this._dirtyStart >= this._dirtyEnd)
            return;
        const start = this._dirtyStart;
        const end = Math.min(this.capacity, this._dirtyEnd);
        this._dirtyStart = 0;
        this._dirtyEnd = 0;
        const bytes = this._data.buffer;
        const view = new Uint8Array(bytes, start * FLOATS_PER_INSTANCE * 4, (end - start) * FLOATS_PER_INSTANCE * 4);
        this.instanceBuffer.write(view, start * FLOATS_PER_INSTANCE * 4);
    }
    /** 是否有待上传的实例矩阵 */
    get hasPendingUpload() {
        return this._dirtyStart < this._dirtyEnd;
    }
    updateWorldBounds(force = false) {
        if (!force && this._boundsVersion === this.worldVersion && this._boundsInstanceVersion === this._instanceVersion)
            return;
        this._boundsVersion = this.worldVersion;
        this._boundsInstanceVersion = this._instanceVersion;
        this._computeInstanceBounds();
        this.applyBoundsFromLocalSphere(this._localCenter, this._localRadius);
    }
    /** 所有实例的联合包围球（局部空间，近似：球心均值 + 最大外扩半径） */
    _computeInstanceBounds() {
        const g = this.geometry;
        const count = this._count;
        if (count <= 0) {
            this._localCenter.copy(g.boundingSphereCenter);
            this._localRadius = g.boundingSphereRadius;
            return;
        }
        const localCenter = g.boundingSphereCenter;
        const localRadius = g.boundingSphereRadius;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        const centers = this._centers;
        for (let i = 0; i < count; i++) {
            this.getMatrixAt(i, this._scratch);
            const e = this._scratch.elements;
            const cx = e[0] * localCenter.x + e[4] * localCenter.y + e[8] * localCenter.z + e[12];
            const cy = e[1] * localCenter.x + e[5] * localCenter.y + e[9] * localCenter.z + e[13];
            const cz = e[2] * localCenter.x + e[6] * localCenter.y + e[10] * localCenter.z + e[14];
            centers[i * 3] = cx;
            centers[i * 3 + 1] = cy;
            centers[i * 3 + 2] = cz;
            sx += cx;
            sy += cy;
            sz += cz;
        }
        this._localCenter.set(sx / count, sy / count, sz / count);
        let radius = 0;
        for (let i = 0; i < count; i++) {
            const cx = centers[i * 3];
            const cy = centers[i * 3 + 1];
            const cz = centers[i * 3 + 2];
            this.getMatrixAt(i, this._scratch);
            const e = this._scratch.elements;
            const scale = Math.max(Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]), Math.sqrt(e[4] * e[4] + e[5] * e[5] + e[6] * e[6]), Math.sqrt(e[8] * e[8] + e[9] * e[9] + e[10] * e[10]));
            const dx = cx - this._localCenter.x;
            const dy = cy - this._localCenter.y;
            const dz = cz - this._localCenter.z;
            radius = Math.max(radius, Math.sqrt(dx * dx + dy * dy + dz * dz) + localRadius * scale);
        }
        this._localRadius = Math.max(1e-4, radius);
    }
    _markDirty(index) {
        this._instanceVersion++;
        if (this._dirtyStart >= this._dirtyEnd) {
            this._dirtyStart = index;
            this._dirtyEnd = index + 1;
        }
        else {
            if (index < this._dirtyStart)
                this._dirtyStart = index;
            if (index + 1 > this._dirtyEnd)
                this._dirtyEnd = index + 1;
        }
    }
    _writeIdentity(index) {
        const base = index * FLOATS_PER_INSTANCE;
        const d = this._data;
        d.fill(0, base, base + FLOATS_PER_INSTANCE);
        d[base] = 1;
        d[base + 5] = 1;
        d[base + 10] = 1;
        d[base + 15] = 1;
    }
    _assertIndex(index) {
        assert(index >= 0 && index < this.capacity, `实例序号 ${index} 超出容量 ${this.capacity}`);
    }
}
//# sourceMappingURL=InstancedMesh.js.map