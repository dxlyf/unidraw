/**
 * Ray —— 三维射线，提供包围球/AABB/三角形求交（用于 CPU 几何拾取）。
 */
import { Vec3 } from "./vec3.js";
export class Ray {
    origin = new Vec3();
    direction = new Vec3(0, 0, -1);
    set(origin, direction) {
        this.origin.copy(origin);
        this.direction.copy(direction).normalize();
        return this;
    }
    at(t, out = new Vec3()) {
        return out.set(this.origin.x + this.direction.x * t, this.origin.y + this.direction.y * t, this.origin.z + this.direction.z * t);
    }
    /** 与球求交，返回最近的正向 t；未命中返回 null */
    intersectSphere(center, radius) {
        const ox = this.origin.x - center.x;
        const oy = this.origin.y - center.y;
        const oz = this.origin.z - center.z;
        const dx = this.direction.x;
        const dy = this.direction.y;
        const dz = this.direction.z;
        const b = ox * dx + oy * dy + oz * dz;
        const c = ox * ox + oy * oy + oz * oz - radius * radius;
        const disc = b * b - c;
        if (disc < 0)
            return null;
        const sq = Math.sqrt(disc);
        const t0 = -b - sq;
        if (t0 >= 0)
            return t0;
        const t1 = -b + sq;
        return t1 >= 0 ? t1 : null;
    }
    /** 与 AABB 求交（slab 法），返回进入 t（原点在盒内返回 0）；未命中 null */
    intersectAABB(min, max) {
        let tmin = -Infinity;
        let tmax = Infinity;
        for (let axis = 0; axis < 3; axis++) {
            const o = axis === 0 ? this.origin.x : axis === 1 ? this.origin.y : this.origin.z;
            const d = axis === 0 ? this.direction.x : axis === 1 ? this.direction.y : this.direction.z;
            const lo = axis === 0 ? min.x : axis === 1 ? min.y : min.z;
            const hi = axis === 0 ? max.x : axis === 1 ? max.y : max.z;
            if (Math.abs(d) < 1e-12) {
                if (o < lo || o > hi)
                    return null;
                continue;
            }
            const inv = 1 / d;
            let t1 = (lo - o) * inv;
            let t2 = (hi - o) * inv;
            if (t1 > t2) {
                const tmp = t1;
                t1 = t2;
                t2 = tmp;
            }
            if (t1 > tmin)
                tmin = t1;
            if (t2 < tmax)
                tmax = t2;
            if (tmin > tmax)
                return null;
        }
        if (tmax < 0)
            return null;
        return tmin >= 0 ? tmin : 0;
    }
    /**
     * Möller–Trumbore 三角形求交（默认双面）。
     * 注意：direction 可以不归一化（用于把射线变换到物体空间后保持世界参数 t 一致）。
     */
    intersectTriangle(a, b, c, backfaceCulling = false) {
        const e1x = b.x - a.x;
        const e1y = b.y - a.y;
        const e1z = b.z - a.z;
        const e2x = c.x - a.x;
        const e2y = c.y - a.y;
        const e2z = c.z - a.z;
        const px = this.direction.y * e2z - this.direction.z * e2y;
        const py = this.direction.z * e2x - this.direction.x * e2z;
        const pz = this.direction.x * e2y - this.direction.y * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (backfaceCulling) {
            if (det < 1e-12)
                return null;
        }
        else if (Math.abs(det) < 1e-12) {
            return null;
        }
        const invDet = 1 / det;
        const tx = this.origin.x - a.x;
        const ty = this.origin.y - a.y;
        const tz = this.origin.z - a.z;
        const u = (tx * px + ty * py + tz * pz) * invDet;
        if (u < 0 || u > 1)
            return null;
        const qx = ty * e1z - tz * e1y;
        const qy = tz * e1x - tx * e1z;
        const qz = tx * e1y - ty * e1x;
        const v = (this.direction.x * qx + this.direction.y * qy + this.direction.z * qz) * invDet;
        if (v < 0 || u + v > 1)
            return null;
        const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
        return t >= 0 ? t : null;
    }
}
//# sourceMappingURL=Ray.js.map