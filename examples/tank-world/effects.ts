/**
 * 特效与炮弹：枪口闪光、爆炸、烟雾、火花（billboard）+ 炮弹轨迹与命中判定。
 *
 * 设计要点：
 * - 所有特效都是**面向相机的四边形**（billboard），用 `blend` 区分：
 *   闪光/爆炸用叠加发光（`additive`），烟雾用普通 alpha 混合；
 * - 资源池化：每种特效预创建固定数量的网格与**独立材质**（同一份材质无法逐特效改颜色/透明度），
 *   复用而不是每次爆炸都新建 —— 由于管线有内容缓存，这些材质的管线/程序是共享的；
 * - 炮弹用「线段 vs 球/盒」做连续碰撞（不是逐帧点检测），高速也不会穿模。
 */

import type { Device } from "../../src/device/Device.js";
import { Mesh } from "../../src/render/Mesh.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box, plane } from "../../src/render/primitives.js";
import { UnlitColorMaterial, blendState } from "../../src/render/material.js";
import { Color } from "../../src/math/color.js";
import { Vec3 } from "../../src/math/vec3.js";
import type { Scene } from "../../src/scene/index.js";
import type { Arena } from "./arena.js";
import type { Tank } from "./tank.js";

const ADDITIVE = blendState({ src: "src-alpha", dst: "one" }, { src: "one", dst: "one" });
const NORMAL_BLEND = blendState({ src: "src-alpha", dst: "one-minus-src-alpha" });

export type EffectKind = "flash" | "explosion" | "smoke" | "spark";

interface EffectSlot {
  mesh: Mesh;
  material: UnlitColorMaterial;
  kind: EffectKind;
  life: number;
  maxLife: number;
  from: number;
  to: number;
  opacity: number;
  /** 每帧上升速度（烟为主） */
  rise: number;
  /** 基础颜色（含 alpha，逐帧覆盖后 setColor） */
  baseColor: Color;
  active: boolean;
}

export interface EffectPoolOptions {
  /** 每种特效的池大小 */
  perKind?: number;
  /** 特效四边形渲染顺序（越大越后画） */
  renderOrder?: number;
}

/**
 * 特效池：`spawn*` 领取一个空闲槽位并设置生命周期/缩放曲线，`update` 每帧推进。
 */
export class EffectPool {
  /** 当前活跃特效数 */
  activeCount = 0;
  private readonly _slots: EffectSlot[][] = [[], [], [], []];
  private readonly _kindIndex: Record<EffectKind, number> = { flash: 0, explosion: 1, smoke: 2, spark: 3 };
  private readonly _perKind: number;
  private readonly _geometry: Geometry;

  constructor(device: Device, scene: Scene, options: EffectPoolOptions = {}) {
    this._perKind = Math.max(2, options.perKind ?? 10);
    this._geometry = Geometry.create(device, plane(1, 1, 1, 1));
    const colors: Record<EffectKind, string> = {
      flash: "#fff0b0",
      explosion: "#ffa040",
      smoke: "#2a2d34",
      spark: "#ffd070",
    };
    for (const kind of Object.keys(this._kindIndex) as EffectKind[]) {
      const index = this._kindIndex[kind];
      for (let i = 0; i < this._perKind; i++) {
        const additive = kind !== "smoke";
        const material = new UnlitColorMaterial(device, new Color().setHex(colors[kind]), {
          label: `fx-${kind}-${i}`,
          alphaBlend: false,
          blend: additive ? ADDITIVE : NORMAL_BLEND,
          depthWrite: false,
          depth: true,
          cullMode: "none",
        });
        const mesh = new Mesh(this._geometry, material);
        mesh.renderOrder = options.renderOrder ?? 5;
        mesh.visible = false;
        mesh.frustumCulled = false; // billboard 生命周期短，跳过剔除更省事
        scene.add(mesh);
        this._slots[index]!.push({
          mesh,
          material,
          kind,
          life: 0,
          maxLife: 1,
          from: 1,
          to: 1,
          opacity: 1,
          rise: 0,
          baseColor: new Color().setHex(colors[kind]),
          active: false,
        });
      }
    }
  }

  private _take(kind: EffectKind): EffectSlot {
    const pool = this._slots[this._kindIndex[kind]]!;
    for (const slot of pool) {
      if (!slot.active) return slot;
    }
    // 都占用了就复用最老的（视觉上几乎无感）
    let oldest = pool[0]!;
    for (const slot of pool) if (slot.life > oldest.life) oldest = slot;
    return oldest;
  }

  /** 枪口闪光：短促、亮、带一点随机翻转 */
  spawnFlash(position: Vec3, scale = 1.8): void {
    const slot = this._take("flash");
    this._activate(slot, position, 0.09, scale * 0.7, scale, 1, 0);
  }

  /** 爆炸：亮球扩散 + 透明度衰减 */
  spawnExplosion(position: Vec3, scale = 3.2): void {
    const slot = this._take("explosion");
    this._activate(slot, position, 0.42, scale * 0.35, scale * 1.6, 1, 0.4);
  }

  /** 烟尘：缓慢上升、变大、变淡 */
  spawnSmoke(position: Vec3, scale = 2.4): void {
    const slot = this._take("smoke");
    this._activate(slot, position, 1.5, scale * 0.5, scale * 1.9, 0.85, 1.6);
  }

  /** 命中火花 */
  spawnSpark(position: Vec3, scale = 0.9): void {
    const slot = this._take("spark");
    this._activate(slot, position, 0.22, scale * 0.4, scale * 1.2, 1, 0.8);
  }

  private _activate(
    slot: EffectSlot,
    position: Vec3,
    life: number,
    from: number,
    to: number,
    opacity: number,
    rise: number,
  ): void {
    slot.active = true;
    slot.life = 0;
    slot.maxLife = life;
    slot.from = from;
    slot.to = to;
    slot.opacity = opacity;
    slot.mesh.visible = true;
    slot.mesh.setPosition(position.x, position.y, position.z);
    slot.mesh.scale.set(from, from, from);
    slot.mesh.markDirty();
    slot.rise = rise;
  }

  /** 推进特效（billboard 朝向相机） */
  update(dt: number, cameraYaw: number, cameraPitch: number): void {
    let active = 0;
    for (const pool of this._slots) {
      for (const slot of pool) {
        if (!slot.active) continue;
        slot.life += dt;
        const t = slot.life / slot.maxLife;
        if (t >= 1) {
          slot.active = false;
          slot.mesh.visible = false;
          continue;
        }
        active++;
        const scale = slot.from + (slot.to - slot.from) * t;
        slot.mesh.scale.set(scale, scale, scale);
        if (slot.rise !== 0) {
          const p = slot.mesh.position;
          slot.mesh.setPosition(p.x, p.y + slot.rise * dt, p.z);
        }
        slot.mesh.setRotation(-cameraPitch, cameraYaw, 0);
        slot.mesh.markDirty();
        // 透明度：前 30% 保持，之后线性衰减（爆炸更“炸”一点）
        const fade = t < 0.3 ? 1 : 1 - (t - 0.3) / 0.7;
        slot.baseColor.a = Math.max(0, slot.opacity * fade);
        slot.material.setColor(slot.baseColor);
      }
    }
    this.activeCount = active;
  }

  /** 当前活跃特效数（HUD/自检用） */
  get count(): number {
    let n = 0;
    for (const pool of this._slots) for (const slot of pool) if (slot.active) n++;
    return n;
  }

}

export interface ProjectileHit {
  kind: "tank" | "obstacle" | "ground" | "timeout";
  position: Vec3;
  tank?: Tank;
  distance: number;
  /** 这一发的伤害（由发射者决定） */
  damage: number;
}

interface Projectile {
  mesh: Mesh;
  material: UnlitColorMaterial;
  position: Vec3;
  velocity: Vec3;
  life: number;
  damage: number;
  owner: Tank;
  active: boolean;
}

/**
 * 炮弹池：直线飞行 + 连续碰撞（线段 vs 坦克球 / 掩体盒 / 地面）。
 */
export class ProjectilePool {
  readonly maxCount: number;
  private readonly _items: Projectile[] = [];
  private readonly _geometry: Geometry;
  private readonly _scratchA = new Vec3();
  private readonly _scratchB = new Vec3();
  private readonly _center = new Vec3();

  constructor(device: Device, scene: Scene, maxCount = 24) {
    this.maxCount = maxCount;
    this._geometry = Geometry.create(device, box(0.14, 0.14, 1.1));
    for (let i = 0; i < maxCount; i++) {
      const material = new UnlitColorMaterial(device, new Color().setHex("#ffd27a"), {
        label: `shell-${i}`,
        blend: ADDITIVE,
        depthWrite: false,
        cullMode: "none",
      });
      const mesh = new Mesh(this._geometry, material);
      mesh.renderOrder = 4;
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this._items.push({
        mesh,
        material,
        position: new Vec3(),
        velocity: new Vec3(),
        life: 0,
        damage: 0,
        owner: null as unknown as Tank,
        active: false,
      });
    }
  }

  get activeCount(): number {
    let n = 0;
    for (const it of this._items) if (it.active) n++;
    return n;
  }

  /** 发射一发（`origin` 已带炮口偏移，避免立刻撞到自己） */
  spawn(origin: Vec3, direction: Vec3, speed: number, owner: Tank, damage: number): boolean {
    for (const it of this._items) {
      if (it.active) continue;
      it.active = true;
      it.life = 0;
      it.damage = damage;
      it.owner = owner;
      it.position.copy(origin);
      it.velocity.copy(direction).normalize().multiplyScalar(speed);
      it.mesh.visible = true;
      it.mesh.setPosition(origin.x, origin.y, origin.z);
      it.mesh.markDirty();
      return true;
    }
    return false;
  }

  /**
   * 推进所有炮弹。
   *
   * @param onHit 命中回调（由主循环负责扣血/特效/计分）
   */
  update(dt: number, arena: Arena, tanks: readonly Tank[], onHit: (hit: ProjectileHit) => void): void {
    for (const it of this._items) {
      if (!it.active) continue;
      it.life += dt;
      const step = this._scratchA.copy(it.velocity).multiplyScalar(dt);
      const distance = step.length();
      const from = this._scratchB.copy(it.position);
      const dir = step.multiplyScalar(1 / Math.max(distance, 1e-6));

      // 1) 掩体
      const obstacleHit = arena.raycast(from, dir, distance);
      // 2) 坦克（线段 vs 球）
      let tankHit: Tank | null = null;
      let tankT = Number.POSITIVE_INFINITY;
      for (const tank of tanks) {
        if (!tank.alive || tank === it.owner) continue;
        const center = tank.getCenter(this._center);

        const t = segmentSphere(from, dir, distance, center, tank.radius + 0.35);
        if (t >= 0 && t < tankT) {
          tankT = t;
          tankHit = tank;
        }
      }
      // 3) 地面
      let groundT = Number.POSITIVE_INFINITY;
      if (it.velocity.y < 0) {
        const t = (0.06 - from.y) / it.velocity.y;
        if (t > 0 && t <= dt) groundT = t;
      }

      const nearest = Math.min(obstacleHit >= 0 ? obstacleHit : Number.POSITIVE_INFINITY, tankT, groundT);
      if (nearest !== Number.POSITIVE_INFINITY) {
        const hitPos = new Vec3(from.x + dir.x * nearest, from.y + dir.y * nearest, from.z + dir.z * nearest);
        it.active = false;
        it.mesh.visible = false;
        onHit({
          kind: tankHit && tankT === nearest ? "tank" : groundT === nearest ? "ground" : "obstacle",
          position: hitPos,
          tank: tankHit && tankT === nearest ? tankHit : undefined,
          distance: nearest,
          damage: it.damage,
        });
        continue;
      }

      // 未命中：继续飞
      it.position.add(step);
      it.mesh.setPosition(it.position.x, it.position.y, it.position.z);
      const yaw = Math.atan2(-dir.x, -dir.z);
      it.mesh.setRotation(-Math.asin(Math.max(-1, Math.min(1, dir.y))), yaw, 0);
      it.mesh.markDirty();

      if (it.life > 3.5 || it.position.y < -2) {
        it.active = false;
        it.mesh.visible = false;
        onHit({ kind: "timeout", position: it.position.clone(), distance: 0, damage: it.damage });
      }
    }
  }

  /** 清空所有在飞的炮弹（重开一局用） */
  clear(): void {
    for (const it of this._items) {
      it.active = false;
      it.mesh.visible = false;
    }
  }
}

/** 线段（from + dir*t, t∈[0,maxT]）与球的最近交点参数；未命中返回 -1 */
export function segmentSphere(from: Vec3, dir: Vec3, maxT: number, center: Vec3, radius: number): number {
  const ox = from.x - center.x;
  const oy = from.y - center.y;
  const oz = from.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c > 0 && b > 0) return -1; // 起点在球外且背离球
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return 0;
  return t <= maxT ? t : -1;
}

/** 供示例使用的坦克类型再导出（避免示例再 import 一次） */
export type { Tank };
