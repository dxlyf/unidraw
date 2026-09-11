/**
 * 坦克（Tank）：车体 + 炮塔 + 炮管 + 血条，以及移动/瞄准/装填逻辑。
 *
 * 层级：`root`（位置 + 车体朝向）→ `turret`（炮塔朝向）→ `barrel`（炮管）
 * 因此炮塔可以独立于车体旋转，炮口世界位置就是炮管末端的节点位置。
 *
 * 所有参数都集中在 `TankOptions`，示例里用 lil-gui 实时调；`update()` 不读全局状态，
 * 输入通过 `TankInput` 传入 —— 这样自检可以注入脚本输入做确定性模拟。
 */

import type { Device } from "../../src/device/Device.js";
import { Node3D } from "../../src/scene/Node3D.js";
import { Mesh } from "../../src/render/Mesh.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box, cylinder, sphere } from "../../src/render/primitives.js";
import { PhongMaterial } from "../../src/render/material.js";
import { Color } from "../../src/math/color.js";
import { Vec3 } from "../../src/math/vec3.js";
import { degToRad } from "../../src/math/mmath.js";
import { Mesh as MeshClass } from "../../src/render/Mesh.js";
import type { Scene } from "../../src/scene/index.js";
import type { Arena } from "./arena.js";

export interface TankOptions {
  /** 队伍颜色（车体/炮塔） */
  color: string;
  /** 最大血量 */
  maxHp?: number;
  /** 前进速度（单位/秒） */
  speed?: number;
  /** 倒车速度 */
  reverseSpeed?: number;
  /** 车体转向速度（弧度/秒） */
  turnRate?: number;
  /** 炮塔转向速度（弧度/秒） */
  turretRate?: number;
  /** 装填时间（秒） */
  reloadTime?: number;
  /** 炮弹速度（单位/秒） */
  shellSpeed?: number;
  /** 单发伤害 */
  damage?: number;
  /** 碰撞半径 */
  radius?: number;
  label?: string;
}

export interface TankInput {
  /** -1..1：前进/倒车 */
  drive: number;
  /** -1..1：车体转向（左负右正） */
  turn: number;
  /** 目标炮塔朝向（世界 yaw，弧度）；null = 不改 */
  turretYaw: number | null;
  /** 是否开火 */
  fire: boolean;
}

export const NO_INPUT: TankInput = { drive: 0, turn: 0, turretYaw: null, fire: false };

export class Tank {
  readonly root = new Node3D();
  readonly turret = new Node3D();
  readonly barrel = new Node3D();
  readonly muzzle = new Node3D();
  readonly options: Required<TankOptions>;
  /** 本坦克的所有网格（血条/碰撞调试用） */
  readonly meshes: MeshClass[] = [];

  hp: number;
  alive = true;
  /** 装填剩余时间（秒） */
  cooldown = 0;
  /** 炮塔当前朝向（世界 yaw） */
  turretYaw: number;
  /** 开火时的后坐/闪光计时（秒） */
  recoil = 0;
  /** 累计命中/击杀（HUD 用） */
  hits = 0;
  kills = 0;

  private readonly _healthBar: MeshClass;
  private readonly _healthFill: MeshClass;
  private readonly _hullMat: PhongMaterial;
  private readonly _turretMat: PhongMaterial;
  private readonly _trackMat: PhongMaterial;
  private readonly _barWidth: number;
  private readonly _scratch = new Vec3();

  constructor(device: Device, scene: Scene, options: TankOptions) {
    this.options = {
      color: options.color,
      maxHp: options.maxHp ?? 100,
      speed: options.speed ?? 13,
      reverseSpeed: options.reverseSpeed ?? 7,
      turnRate: options.turnRate ?? degToRad(110),
      turretRate: options.turretRate ?? degToRad(150),
      reloadTime: options.reloadTime ?? 1.15,
      shellSpeed: options.shellSpeed ?? 62,
      damage: options.damage ?? 34,
      radius: options.radius ?? 1.35,
      label: options.label ?? "tank",
    };
    this.hp = this.options.maxHp;
    this.turretYaw = 0;

    const trackColor = "#20242c";
    this._hullMat = new PhongMaterial(device, new Color().setHex(options.color), {
      label: `${this.options.label}-hull`,
      shininess: 42,
      specular: 0.45,
      ambient: 0.4,
    });
    this._turretMat = new PhongMaterial(device, new Color().setHex(options.color).scale(1.12), {
      label: `${this.options.label}-turret`,
      shininess: 56,
      specular: 0.5,
      ambient: 0.4,
    });
    this._trackMat = new PhongMaterial(device, new Color().setHex(trackColor), {
      label: `${this.options.label}-track`,
      shininess: 6,
      specular: 0.05,
      ambient: 0.4,
    });

    // 车体（略扁的盒子）+ 两侧履带
    const hull = new Mesh(Geometry.create(device, box(2.1, 0.7, 3.2)));
    hull.setPosition(0, 0.62, 0);
    hull.material = this._hullMat;
    this.root.add(hull);

    for (const side of [-1, 1]) {
      const track = new Mesh(Geometry.create(device, box(0.42, 0.62, 3.4)));
      track.setPosition(side * 1.18, 0.36, 0);
      track.material = this._trackMat;
      this.root.add(track);
    }

    // 炮塔（六棱柱更像坦克）+ 炮管
    const turretMesh = new Mesh(Geometry.create(device, cylinder(0.92, 1.02, 0.62, 6, 1, true)));
    turretMesh.setPosition(0, 1.28, -0.1);
    turretMesh.setRotation(0, Math.PI / 6, 0);
    turretMesh.material = this._turretMat;
    this.turret.add(turretMesh);

    const barrel = new Mesh(Geometry.create(device, cylinder(0.11, 0.13, 2.5, 10, 1, true)));
    barrel.model.setIdentity().rotateX(degToRad(90)).translate(0, 0, -1.7);
    barrel.material = this._turretMat;
    this.barrel.add(barrel);
    this.barrel.setPosition(0, 1.34, -0.85);
    this.turret.add(this.barrel);

    // 炮口标记节点（取世界位置用）
    this.muzzle.setPosition(0, 0, -2.95);
    this.barrel.add(this.muzzle);

    this.turret.setPosition(0, 0, 0);
    this.root.add(this.turret);

    // 血条：背景 + 填充（面向相机的两个薄片）
    this._barWidth = 2.4;
    const barMat = new PhongMaterial(device, new Color(0.05, 0.06, 0.08, 1), {
      label: `${this.options.label}-hp-bg`,
      shininess: 2,
      ambient: 1,
      cullMode: "none",
    });
    const fillMat = new PhongMaterial(device, new Color().setHex("#6fe3a1"), {
      label: `${this.options.label}-hp`,
      shininess: 2,
      ambient: 1,
      cullMode: "none",
    });
    this._healthBar = new Mesh(Geometry.create(device, box(this._barWidth, 0.14, 0.02)));
    this._healthBar.setPosition(0, 2.5, 0);
    this._healthBar.material = barMat;
    this._healthFill = new Mesh(Geometry.create(device, box(this._barWidth - 0.08, 0.09, 0.03)));
    this._healthFill.setPosition(0, 2.5, -0.01);
    this._healthFill.material = fillMat;
    this.root.add(this._healthBar);
    this.root.add(this._healthFill);

    this.meshes.push(hull, turretMesh, this._healthBar, this._healthFill);
    scene.add(this.root);
  }

  get label(): string {
    return this.options.label;
  }

  get radius(): number {
    return this.options.radius;
  }

  /** 世界位置（复用 `out`）；会先刷新世界矩阵（游戏逻辑在渲染之前也要读） */
  getPosition(out = new Vec3()): Vec3 {
    this.root.updateWorldMatrix();
    return this.root.getWorldPosition(out);
  }

  /** 炮口世界位置 */
  getMuzzlePosition(out = new Vec3()): Vec3 {
    this.root.updateWorldMatrix();
    return this.muzzle.getWorldPosition(out);
  }

  /** 炮塔朝向的世界方向（XZ 平面 + 一点点仰角） */
  getAimDirection(out = new Vec3()): Vec3 {
    const yaw = this.turretYaw;
    return out.set(-Math.sin(yaw), 0.02, -Math.cos(yaw)).normalize();
  }

  /**
   * 推进一帧。
   *
   * @param dt 秒（已 clamp）
   * @param input 输入（脚本/键盘都走这里）
   * @param arena 用于碰撞（圆 vs 掩体）
   * @returns 是否发生了碰撞（示例用来播放“撞墙”震动）
   */
  update(dt: number, input: TankInput, arena: Arena): boolean {
    if (!this.alive) return false;
    // 车体转向（沿 Y 轴）
    this.root.setRotation(0, this.getYaw() + input.turn * this.options.turnRate * dt, 0);
    this.root.markDirty();

    // 前进/倒车（沿车体 -Z）
    const speed = input.drive >= 0 ? input.drive * this.options.speed : input.drive * this.options.reverseSpeed;
    if (speed !== 0) {
      const yaw = this.getYaw();
      const position = this.getPosition(this._scratch);
      position.x += -Math.sin(yaw) * speed * dt;
      position.z += -Math.cos(yaw) * speed * dt;
      const blocked = arena.resolveCircle(position, this.options.radius);
      this.root.setPosition(position.x, 0, position.z);
      this.root.markDirty();
      this._moved = blocked;
    } else {
      this._moved = false;
    }

    // 炮塔转向（朝目标角平滑旋转，走最短弧）
    if (input.turretYaw !== null) {
      let delta = input.turretYaw - this.turretYaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      const step = Math.sign(delta) * Math.min(Math.abs(delta), this.options.turretRate * dt);
      this.turretYaw += step;
    } else if (this._autoTurretYaw !== null) {
      let delta = this._autoTurretYaw - this.turretYaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.turretYaw += Math.sign(delta) * Math.min(Math.abs(delta), this.options.turretRate * dt);
    }
    // 炮塔是 root 的子节点 → 局部角度 = 世界角 - 车体角
    this.turret.setRotation(0, this.turretYaw - this.getYaw(), 0);
    this.turret.markDirty();

    // 装填与后坐
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt);
    this.barrel.setPosition(0, 1.34, -0.85 + this.recoil * 1.1);

    return this._moved;
  }

  private _moved = false;
  private _autoTurretYaw: number | null = null;

  /** 车体世界 yaw（-Z 为前方） */
  getYaw(): number {
    this.root.updateWorldMatrix();
    const e = this.root.worldMatrix.elements;
    // Ry(θ) 的列主序：e[2] = -sinθ, e[10] = cosθ → θ = atan2(-e[2], e[10])
    return Math.atan2(-e[2]!, e[10]!);
  }

  /** 让炮塔自动朝向某点（AI 用；`update` 里会平滑转过去） */
  aimAt(target: Vec3): void {
    const position = this.getPosition(this._scratch);
    this._autoTurretYaw = Math.atan2(-(target.x - position.x), -(target.z - position.z));
  }

  /** 车体朝向某点（AI 用） */
  turnToward(target: Vec3, dt: number): number {
    const position = this.getPosition(this._scratch);
    const desired = Math.atan2(-(target.x - position.x), -(target.z - position.z));
    let delta = desired - this.getYaw();
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const step = Math.sign(delta) * Math.min(Math.abs(delta), this.options.turnRate * dt);
    this.root.setRotation(0, this.getYaw() + step, 0);
    this.root.markDirty();
    return delta;
  }

  /** 能否开火（活着 + 装填完毕） */
  canFire(): boolean {
    return this.alive && this.cooldown <= 0;
  }

  /** 开火：返回炮口位置与方向（由外部生成炮弹），并进入装填 */
  fire(): { origin: Vec3; direction: Vec3 } | null {
    if (!this.canFire()) return null;
    this.cooldown = this.options.reloadTime;
    this.recoil = 0.12;
    return { origin: this.getMuzzlePosition(new Vec3()), direction: this.getAimDirection(new Vec3()) };
  }

  /** 受伤（返回是否被击毁） */
  damage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.updateHealthBar();
    if (this.hp <= 0) {
      this.alive = false;
      this.root.visible = false;
      return true;
    }
    return false;
  }

  /** 复活/重置 */
  reset(x: number, z: number, yaw = 0): void {
    this.hp = this.options.maxHp;
    this.alive = true;
    this.cooldown = 0;
    this.turretYaw = yaw;
    this.root.visible = true;
    this.root.setPosition(x, 0, z);
    this.root.setRotation(0, yaw, 0);
    this.root.markDirty();
    this.turret.setRotation(0, 0, 0);
    this.updateHealthBar();
  }

  /** 血条填充缩放 + 面向相机（相机 yaw 传给所有坦克） */
  updateHealthBar(): void {
    const ratio = Math.max(0, this.hp / this.options.maxHp);
    this._healthFill.scale.set(Math.max(0.001, ratio), 1, 1);
    this._healthFill.setPosition((ratio - 1) * (this._barWidth / 2), 2.5, -0.01);
    this._healthFill.markDirty();
  }

  /** 血条朝向相机（billboard：只绕 Y 轴） */
  faceCamera(cameraYaw: number): void {
    this._healthBar.setRotation(0, cameraYaw, 0);
    this._healthFill.setRotation(0, cameraYaw, 0);
    this._healthBar.visible = this.alive && this.hp < this.options.maxHp;
    this._healthFill.visible = this._healthBar.visible;
  }

  /** 供拾取/命中判定用的包围球中心（车体中部） */
  getCenter(out = new Vec3()): Vec3 {
    const p = this.getPosition(out);
    return p.set(p.x, 0.9, p.z);
  }

  /** 未使用的球体引用（保留给后续升级：炮塔顶盖） */
  static readonly turretCapGeometry = sphere;
}
