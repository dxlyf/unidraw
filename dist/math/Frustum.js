/**
 * Frustum —— 由投影·视图矩阵提取 6 个裁剪平面，用于视锥剔除。
 *
 * 支持两种 NDC 深度约定：
 * - `zZeroToOne = true`（默认，WebGPU/D3D 风格，near=0 far=1）
 * - `zZeroToOne = false`（OpenGL 风格，near=-1 far=1）
 */
import { Vec4 } from "./vec4.js";
export class Frustum {
    /** left, right, bottom, top, near, far */
    planes = [new Vec4(), new Vec4(), new Vec4(), new Vec4(), new Vec4(), new Vec4()];
    setFromProjectionMatrix(m, zZeroToOne = true) {
        const e = m.elements;
        // 行向量（列主序矩阵）
        const r0x = e[0];
        const r0y = e[4];
        const r0z = e[8];
        const r0w = e[12];
        const r1x = e[1];
        const r1y = e[5];
        const r1z = e[9];
        const r1w = e[13];
        const r2x = e[2];
        const r2y = e[6];
        const r2z = e[10];
        const r2w = e[14];
        const r3x = e[3];
        const r3y = e[7];
        const r3z = e[11];
        const r3w = e[15];
        const set = (i, x, y, z, w) => {
            const len = Math.hypot(x, y, z);
            const inv = len > 1e-12 ? 1 / len : 1;
            this.planes[i].set(x * inv, y * inv, z * inv, w * inv);
        };
        set(0, r3x + r0x, r3y + r0y, r3z + r0z, r3w + r0w); // left
        set(1, r3x - r0x, r3y - r0y, r3z - r0z, r3w - r0w); // right
        set(2, r3x + r1x, r3y + r1y, r3z + r1z, r3w + r1w); // bottom
        set(3, r3x - r1x, r3y - r1y, r3z - r1z, r3w - r1w); // top
        if (zZeroToOne)
            set(4, r2x, r2y, r2z, r2w); // near: z >= 0
        else
            set(4, r3x + r2x, r3y + r2y, r3z + r2z, r3w + r2w);
        set(5, r3x - r2x, r3y - r2y, r3z - r2z, r3w - r2w); // far
        return this;
    }
    intersectsSphere(centerOrSphere, radius) {
        const center = radius === undefined ? centerOrSphere.center : centerOrSphere;
        const r = radius === undefined ? centerOrSphere.radius : radius;
        for (let i = 0; i < 6; i++) {
            const p = this.planes[i];
            const d = p.x * center.x + p.y * center.y + p.z * center.z + p.w;
            if (d < -r)
                return false;
        }
        return true;
    }
    /** 点是否在视锥内（6 个平面都要判：少判一个会把视锥外侧当成"可见"） */
    containsPoint(point) {
        for (let i = 0; i < 6; i++) {
            const p = this.planes[i];
            if (p.x * point.x + p.y * point.y + p.z * point.z + p.w < 0)
                return false;
        }
        return true;
    }
    /** AABB（`Box3`）是否与视锥相交 */
    intersectsBox(box) {
        return this.intersectsAABB(box.min, box.max);
    }
    clone() {
        const out = new Frustum();
        for (let i = 0; i < 6; i++)
            out.planes[i].copy(this.planes[i]);
        return out;
    }
    /** AABB 是否与视锥相交（保守：正/负顶点法） */
    intersectsAABB(min, max) {
        for (let i = 0; i < 6; i++) {
            const p = this.planes[i];
            const px = p.x >= 0 ? max.x : min.x;
            const py = p.y >= 0 ? max.y : min.y;
            const pz = p.z >= 0 ? max.z : min.z;
            if (p.x * px + p.y * py + p.z * pz + p.w < 0)
                return false;
        }
        return true;
    }
}
//# sourceMappingURL=Frustum.js.map