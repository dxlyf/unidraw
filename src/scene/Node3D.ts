import { Mat4 } from "../math/mat4.js";
import { Vec3 } from "../math/vec3.js";

let nextNodeId = 1;

function matEquals(a: Float32Array, b: Float32Array): boolean {
  for (let i = 0; i < 16; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export class Node3D {
  readonly id: number = nextNodeId++;
  name = "";
  visible = true;
  readonly children: Node3D[] = [];
  parent: Node3D | null = null;

  /** 局部变换矩阵（列主序） */
  readonly matrix = new Mat4();
  /** 世界变换矩阵（由 updateWorldMatrix 维护） */
  readonly worldMatrix = new Mat4();

  /** TRS（写入 matrix 的便捷通道） */
  readonly position = new Vec3(0, 0, 0);
  /** 欧拉角（弧度，顺序 Z→Y→X 内旋，等价矩阵 Rz·Ry·Rx） */
  readonly rotation = new Vec3(0, 0, 0);
  readonly scale = new Vec3(1, 1, 1);

  /** 世界矩阵版本号（变化时自增，供子节点/剔除缓存判断） */
  worldVersion = 0;

  private _dirty = true;
  private readonly _snapshot = new Float32Array(16);
  private _lastParentVersion = -1;

  /** 兼容旧 API：model 即局部矩阵 */
  get model(): Mat4 {
    return this.matrix;
  }
  set model(m: Mat4) {
    this.matrix.copy(m);
  }

  setPosition(x: number, y: number, z: number): this {
    this.position.set(x, y, z);
    this._dirty = true;
    return this;
  }
  setRotation(x: number, y: number, z: number): this {
    this.rotation.set(x, y, z);
    this._dirty = true;
    return this;
  }
  setScale(x: number, y: number, z: number): this {
    this.scale.set(x, y, z);
    this._dirty = true;
    return this;
  }
  /** 一次写入 TRS（等价 matrix = T·R·S） */
  setTRS(position: Vec3, rotation?: Vec3, scale?: Vec3): this {
    this.position.copy(position);
    if (rotation) this.rotation.copy(rotation);
    if (scale) this.scale.copy(scale);
    this._dirty = true;
    return this;
  }
  /** 就地改 matrix 后强制标记（一般无需调用，自动检测即可） */
  markDirty(): this {
    this._dirty = true;
    return this;
  }

  add(...nodes: Node3D[]): this {
    for (const node of nodes) {
      if (node === this) continue;
      if (node.parent === this) continue;
      if (node.parent) node.parent.remove(node);
      node.parent = this;
      node._lastParentVersion = -1; // 强制重算世界矩阵
      this.children.push(node);
    }
    return this;
  }

  remove(...nodes: Node3D[]): this {
    for (const node of nodes) {
      const i = this.children.indexOf(node);
      if (i >= 0) {
        this.children.splice(i, 1);
        node.parent = null;
        node._lastParentVersion = -1;
      }
    }
    return this;
  }

  removeFromParent(): this {
    this.parent?.remove(this);
    return this;
  }

  /** 深度优先遍历（含自身） */
  traverse(visit: (node: Node3D) => void): void {
    visit(this);
    for (let i = 0; i < this.children.length; i++) {
      this.children[i]!.traverse(visit);
    }
  }

  /** 深度优先遍历（跳过 visible=false 的子树） */
  traverseVisible(visit: (node: Node3D) => void): void {
    if (!this.visible) return;
    visit(this);
    for (let i = 0; i < this.children.length; i++) {
      this.children[i]!.traverseVisible(visit);
    }
  }

  /** 局部矩阵是否有变化（TRS 脏标记 或 直接改 matrix 的快照比较） */
  private _updateLocal(): boolean {
    if (this._dirty) {
      this._composeFromTRS();
      this._dirty = false;
      this._snapshot.set(this.matrix.elements);
      return true;
    }
    if (!matEquals(this.matrix.elements, this._snapshot)) {
      this._snapshot.set(this.matrix.elements);
      return true;
    }
    return false;
  }

  private _composeFromTRS(): void {
    this.matrix
      .setIdentity()
      .translate(this.position.x, this.position.y, this.position.z)
      .rotateEuler(this.rotation.x, this.rotation.y, this.rotation.z)
      .scale(this.scale.x, this.scale.y, this.scale.z);
  }

  /**
   * 更新本节点及子节点的世界矩阵。
   * @param force 强制重算整棵子树
   * @param parentWorld 父节点世界矩阵（根节点省略）
   * @param parentWorldVersion 父节点世界矩阵版本
   */
  updateWorldMatrix(force = false, parentWorld?: Mat4, parentWorldVersion = -1): void {
    const localChanged = this._updateLocal();
    const worldChanged = force || localChanged || this._lastParentVersion !== parentWorldVersion;
    if (worldChanged) {
      if (parentWorld) Mat4.multiply(parentWorld, this.matrix, this.worldMatrix);
      else this.worldMatrix.copy(this.matrix);
      this.worldVersion++;
    }
    this._lastParentVersion = parentWorldVersion;
    for (let i = 0; i < this.children.length; i++) {
      this.children[i]!.updateWorldMatrix(worldChanged, this.worldMatrix, this.worldVersion);
    }
  }

  /** 世界空间位置（需要 worldMatrix 已更新） */
  getWorldPosition(out = new Vec3()): Vec3 {
    const e = this.worldMatrix.elements;
    return out.set(e[12]!, e[13]!, e[14]!);
  }

  /** 世界矩阵三轴的最大缩放（用于包围球半径/法线校正） */
  getMaxWorldScale(): number {
    const e = this.worldMatrix.elements;
    const sx = Math.hypot(e[0]!, e[1]!, e[2]!);
    const sy = Math.hypot(e[4]!, e[5]!, e[6]!);
    const sz = Math.hypot(e[8]!, e[9]!, e[10]!);
    return Math.max(sx, Math.max(sy, sz));
  }
}
