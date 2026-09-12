/**
 * Raycaster —— CPU 几何拾取：屏幕 NDC → 世界射线 → 逐个 Mesh 命中三角形。
 *
 * 两级加速：
 * 1) 世界包围球（先在物体空间用局部包围球快速排除）；
 * 2) 三角形 Möller–Trumbore 精确求交（可只取最近命中）。
 *
 * 命中结果按世界距离升序返回。
 */
import { Mat4 } from "./mat4.js";
import { Vec3 } from "./vec3.js";
import { Ray } from "./Ray.js";
import { Mesh } from "../render/Mesh.js";
export class Raycaster {
    ray = new Ray();
    near = 0;
    far = Number.POSITIVE_INFINITY;
    backfaceCulling = false;
    firstHitOnly = true;
    _invWorld = new Mat4();
    _localOrigin = new Vec3();
    _localDir = new Vec3();
    _localRay = new Ray();
    _dir = new Vec3();
    _near = new Vec3();
    _farPt = new Vec3();
    _v0 = new Vec3();
    _v1 = new Vec3();
    _v2 = new Vec3();
    _w0 = new Vec3();
    _w1 = new Vec3();
    _w2 = new Vec3();
    _normal = new Vec3();
    _hits = [];
    constructor(options = {}) {
        if (options.near !== undefined)
            this.near = options.near;
        if (options.far !== undefined)
            this.far = options.far;
        if (options.backfaceCulling !== undefined)
            this.backfaceCulling = options.backfaceCulling;
        if (options.firstHitOnly !== undefined)
            this.firstHitOnly = options.firstHitOnly;
    }
    /** 由相机 + NDC 坐标（-1..1）构建射线 */
    setFromCamera(camera, ndcX, ndcY) {
        const inv = Mat4.inverse(camera.viewProjection, this._invWorld);
        if (!inv) {
            this.ray.set(camera.eyePosition, new Vec3(0, 0, -1));
            return this;
        }
        // 默认 ZO 约定：z=0 近平面，z=1 远平面
        const near = new Vec3(ndcX, ndcY, 0).applyMat4(inv);
        const far = new Vec3(ndcX, ndcY, 1).applyMat4(inv);
        this._dir.copy(far).sub(near);
        this.ray.set(near, this._dir);
        this._near.copy(near);
        this._farPt.copy(far);
        return this;
    }
    /** 对单个 Mesh（及其可见子树）做拾取，结果按距离升序写入 out */
    intersectObject(mesh, recursive = true, out = []) {
        const visit = (node) => {
            if (!(node instanceof Mesh))
                return;
            const hit = this._intersectMesh(node);
            if (hit)
                out.push(hit);
        };
        if (recursive)
            mesh.traverseVisible(visit);
        else
            visit(mesh);
        out.sort((a, b) => a.distance - b.distance);
        return out;
    }
    /** 对整个场景/节点树拾取（按距离升序） */
    intersectObjects(root, out = []) {
        out.length = 0;
        const visit = (node) => {
            if (!(node instanceof Mesh))
                return;
            const hit = this._intersectMesh(node);
            if (hit)
                out.push(hit);
        };
        root.traverseVisible(visit);
        out.sort((a, b) => a.distance - b.distance);
        return out;
    }
    /** 便捷：拾取最近的物体 */
    intersectFirst(root) {
        const hits = this.intersectObjects(root, this._hits);
        return hits.length > 0 ? hits[0] : null;
    }
    _intersectMesh(mesh) {
        const geo = mesh.geometry;
        if (!geo.positionsCPU)
            return null; // 未保留 CPU 数据 → 只能用颜色拾取
        const world = mesh.worldMatrix;
        // 世界矩阵是否含缩放：用逆矩阵把射线变到物体空间（方向不归一化，保持 t 一致）
        const inv = Mat4.inverse(world, this._invWorld);
        if (!inv)
            return null;
        this._localOrigin.copy(this.ray.origin).applyMat4(inv);
        this._localDir.set(this.ray.direction.x, this.ray.direction.y, this.ray.direction.z).applyMat4Dir(inv);
        this._localRay.set(this._localOrigin, this._localDir);
        // 包围球预剔除
        if (this._localRay.intersectSphere(geo.boundingSphereCenter, geo.boundingSphereRadius) === null)
            return null;
        const pos = geo.positionsCPU;
        const idx = geo.indicesCPU;
        const triCount = idx ? idx.length / 3 : Math.floor(geo.vertexCount / 3);
        let bestT = Number.POSITIVE_INFINITY;
        let bestFace = -1;
        const near = this.near;
        const far = this.far;
        const a = this._v0;
        const b = this._v1;
        const c = this._v2;
        for (let f = 0; f < triCount; f++) {
            const i0 = idx ? idx[f * 3] : f * 3;
            const i1 = idx ? idx[f * 3 + 1] : f * 3 + 1;
            const i2 = idx ? idx[f * 3 + 2] : f * 3 + 2;
            a.set(pos[i0 * 3], pos[i0 * 3 + 1], pos[i0 * 3 + 2]);
            b.set(pos[i1 * 3], pos[i1 * 3 + 1], pos[i1 * 3 + 2]);
            c.set(pos[i2 * 3], pos[i2 * 3 + 1], pos[i2 * 3 + 2]);
            const t = this._localRay.intersectTriangle(a, b, c, this.backfaceCulling);
            if (t === null)
                continue;
            if (t < near || t > far)
                continue;
            if (t < bestT) {
                bestT = t;
                bestFace = f;
            }
        }
        if (bestFace < 0)
            return null;
        // 计算世界命中点与法线（用世界空间三角形，自动处理非均匀缩放）
        const i0 = idx ? idx[bestFace * 3] : bestFace * 3;
        const i1 = idx ? idx[bestFace * 3 + 1] : bestFace * 3 + 1;
        const i2 = idx ? idx[bestFace * 3 + 2] : bestFace * 3 + 2;
        const w0 = this._w0.set(pos[i0 * 3], pos[i0 * 3 + 1], pos[i0 * 3 + 2]).applyMat4(world);
        const w1 = this._w1.set(pos[i1 * 3], pos[i1 * 3 + 1], pos[i1 * 3 + 2]).applyMat4(world);
        const w2 = this._w2.set(pos[i2 * 3], pos[i2 * 3 + 1], pos[i2 * 3 + 2]).applyMat4(world);
        crossABAC(w0, w1, w2, this._normal).normalize();
        return { object: mesh, distance: bestT, point: this.ray.at(bestT), normal: this._normal.clone(), faceIndex: bestFace };
    }
}
/** out = (b-a) × (c-a) */
function crossABAC(a, b, c, out) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    const acz = c.z - a.z;
    out.set(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx);
    return out;
}
//# sourceMappingURL=Raycaster.js.map