/**
 * 战场（arena）：地面、掩体与碰撞。
 *
 * 为了保持示例简洁，碰撞用**圆 vs AABB**（XZ 平面）近似：
 * - 坦克是半径 `radius` 的圆（用包围球近似）；
 * - 掩体是轴对齐盒子（`x/z` 范围 + 高度），只有低于掩体顶部的物体才会被挡；
 * - `resolveCircle` 把圆推出盒子（返回是否发生碰撞），`segmentHit` 用射线与盒子的
 *   平板相交判断炮弹是否命中。
 */

import type { Device } from "../../src/device/Device.js";
import { Mesh } from "../../src/render/Mesh.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box, plane } from "../../src/render/primitives.js";
import { ColorMaterial, PhongMaterial } from "../../src/render/material.js";
import { Color } from "../../src/math/color.js";
import { Vec3 } from "../../src/math/vec3.js";
import { degToRad } from "../../src/math/mmath.js";
import type { Scene } from "../../src/scene/index.js";

/** 轴对齐盒子（XZ 范围 + 高度） */
export interface BoxObstacle {
  x: number;
  z: number;
  /** 半宽（X） */
  hx: number;
  /** 半深（Z） */
  hz: number;
  /** 高度（从地面算起） */
  height: number;
  mesh: Mesh;
}

export interface ArenaOptions {
  /** 战场半径（正方形半边长） */
  halfSize?: number;
  /** 随机种子（0 = 用固定布局，便于自检可复现） */
  seed?: number;
  /** 是否放随机掩体 */
  random?: boolean;
}

/** 简易可复现随机数（mulberry32） */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Arena {
  readonly halfSize: number;
  readonly obstacles: BoxObstacle[] = [];
  readonly device: Device;

  private readonly _materials: PhongMaterial[] = [];

  constructor(device: Device, scene: Scene, options: ArenaOptions = {}) {
    this.device = device;
    this.halfSize = options.halfSize ?? 46;

    // 地面：大平面 + 淡淡的网格感（用两层平面做出“跑道”）
    const groundMat = new PhongMaterial(device, new Color().setHex("#3b4450"), {
      label: "ground",
      shininess: 8,
      specular: 0.05,
      ambient: 0.5,
    });
    const ground = new Mesh(Geometry.create(device, plane(this.halfSize * 2, this.halfSize * 2, 1, 1)));
    ground.model.setIdentity().rotateX(degToRad(-90));
    ground.material = groundMat;
    scene.add(ground);

    const stripeMat = new ColorMaterial(device, new Color(0.22, 0.24, 0.28, 1), { label: "stripe" });
    const stripe = new Mesh(Geometry.create(device, plane(6, this.halfSize * 2, 1, 1)));
    stripe.model.setIdentity().rotateX(degToRad(-90)).translate(0, 0.01, 0);
    stripe.material = stripeMat;
    scene.add(stripe);

    // 掩体：固定布局（可复现）+ 可选随机补充
    const layout: [number, number, number, number, number][] = [
      // x, z, 半宽, 半深, 高
      [-14, -10, 2.4, 2.4, 3.2],
      [13, -14, 3.0, 2.0, 4.0],
      [-20, 12, 2.0, 3.4, 2.6],
      [16, 12, 2.6, 2.6, 3.6],
      [0, -28, 6.0, 1.6, 2.2],
      [-32, -2, 1.8, 5.0, 3.0],
      [30, 0, 1.8, 4.0, 3.4],
      [-4, 22, 4.4, 1.8, 2.4],
      [24, 26, 2.2, 2.2, 2.8],
      [-26, 30, 2.6, 2.6, 3.0],
    ];
    const random = options.random === false ? null : createRandom(options.seed ?? 20240607);
    if (random) {
      for (let i = 0; i < 8; i++) {
        const x = (random() * 2 - 1) * (this.halfSize - 8);
        const z = (random() * 2 - 1) * (this.halfSize - 8);
        if (Math.hypot(x, z) < 12) continue; // 出生点附近留空
        const hx = 1.4 + random() * 1.6;
        const hz = 1.4 + random() * 1.6;
        layout.push([x, z, hx, hz, 2 + random() * 2.4]);
      }
    }

    const colors = ["#5a6270", "#4c5560", "#66707d", "#525b68"];
    for (let i = 0; i < layout.length; i++) {
      const [x, z, hx, hz, height] = layout[i]!;
      const material = new PhongMaterial(device, new Color().setHex(colors[i % colors.length]!), {
        label: `block-${i}`,
        shininess: 16,
        specular: 0.15,
        ambient: 0.45,
      });
      this._materials.push(material);
      const mesh = new Mesh(Geometry.create(device, box(hx * 2, height, hz * 2)));
      mesh.setPosition(x, height / 2, z);
      mesh.material = material;
      scene.add(mesh);
      this.obstacles.push({ x, z, hx, hz, height, mesh });
    }
  }

  /** 把「半径 radius 的圆」推出所有掩体（返回是否碰撞过），并限制在战场内 */
  resolveCircle(position: Vec3, radius: number): boolean {
    let hit = false;
    for (const o of this.obstacles) {
      const dx = position.x - o.x;
      const dz = position.z - o.z;
      const px = o.hx + radius - Math.abs(dx);
      const pz = o.hz + radius - Math.abs(dz);
      if (px <= 0 || pz <= 0) continue;
      hit = true;
      // 沿穿透较浅的轴推出
      if (px < pz) position.x = o.x + Math.sign(dx || 1) * (o.hx + radius);
      else position.z = o.z + Math.sign(dz || 1) * (o.hz + radius);
    }
    const limit = this.halfSize - radius - 0.5;
    if (position.x > limit) {
      position.x = limit;
      hit = true;
    } else if (position.x < -limit) {
      position.x = -limit;
      hit = true;
    }
    if (position.z > limit) {
      position.z = limit;
      hit = true;
    } else if (position.z < -limit) {
      position.z = -limit;
      hit = true;
    }
    return hit;
  }

  /** 该位置是否在掩体内部（用于 AI 判断/放置） */
  blocked(x: number, z: number, radius: number): boolean {
    for (const o of this.obstacles) {
      if (Math.abs(x - o.x) < o.hx + radius && Math.abs(z - o.z) < o.hz + radius) return true;
    }
    return false;
  }

  /**
   * 射线 vs 掩体（返回最近的命中距离，未命中返回 -1）。
   *
   * 用平板法（slab）在 3D 盒子上求交：盒子高度从 0 到 `height`。
   */
  raycast(origin: Vec3, direction: Vec3, maxDistance: number): number {
    let best = -1;
    for (const o of this.obstacles) {
      const t = rayBox(origin, direction, o.x - o.hx, 0, o.z - o.hz, o.x + o.hx, o.height, o.z + o.hz, maxDistance);
      if (t >= 0 && (best < 0 || t < best)) best = t;
    }
    return best;
  }
}

/** 射线与 AABB 求交（平板法）；返回命中距离，未命中返回 -1 */
export function rayBox(
  origin: Vec3,
  direction: Vec3,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  maxDistance: number,
): number {
  let tMin = 0;
  let tMax = maxDistance;
  const o = [origin.x, origin.y, origin.z];
  const d = [direction.x, direction.y, direction.z];
  const lo = [minX, minY, minZ];
  const hi = [maxX, maxY, maxZ];
  for (let axis = 0; axis < 3; axis++) {
    const dir = d[axis]!;
    const org = o[axis]!;
    if (Math.abs(dir) < 1e-8) {
      if (org < lo[axis]! || org > hi[axis]!) return -1;
      continue;
    }
    const inv = 1 / dir;
    let t1 = (lo[axis]! - org) * inv;
    let t2 = (hi[axis]! - org) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return -1;
  }
  return tMin;
}
