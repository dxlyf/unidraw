import { assertFinite } from "../util/assert.js";
import { clamp } from "./mmath.js";

/**
 * 4x4 矩阵，列主序（column-major），与 OpenGL / WebGPU 着色器一致。
 *
 * 实例方法就地修改并返回 this，便于链式调用：
 * `Mat4.identity().translate(1,0,0).rotateY(rad).scale(2,2,2)`
 * 等价于 M = T * R * S（先缩放、再旋转、最后平移）。
 */
export class Mat4 {
  readonly elements: Float32Array;

  constructor() {
    this.elements = new Float32Array(16);
    this.setIdentity();
  }

  static identity(): Mat4 {
    return new Mat4();
  }

  setIdentity(): this {
    this.elements.fill(0);
    const e = this.elements;
    e[0] = 1;
    e[5] = 1;
    e[10] = 1;
    e[15] = 1;
    return this;
  }

  copy(m: Mat4): this {
    this.elements.set(m.elements);
    return this;
  }

  clone(): Mat4 {
    return new Mat4().copy(this);
  }

  /** this = this * rhs */
  multiply(rhs: Mat4): this {
    Mat4.multiply(this, rhs, this);
    return this;
  }

  /** this = lhs * this */
  premultiply(lhs: Mat4): this {
    Mat4.multiply(lhs, this, this);
    return this;
  }

  /** out = a * b；a 或 b 可与 out 相同。 */
  static multiply(a: Mat4, b: Mat4, out = new Mat4()): Mat4 {
    const ae = a.elements;
    const be = b.elements;
    const te = out.elements;
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += ae[k * 4 + r]! * be[c * 4 + k]!;
        }
        te[c * 4 + r] = sum;
      }
    }
    return out;
  }

  /** this = this * T(x,y,z) */
  translate(x: number, y: number, z: number): this {
    const e = this.elements;
    e[12] += e[0] * x + e[4] * y + e[8] * z;
    e[13] += e[1] * x + e[5] * y + e[9] * z;
    e[14] += e[2] * x + e[6] * y + e[10] * z;
    e[15] += e[3] * x + e[7] * y + e[11] * z;
    return this;
  }

  rotateX(rad: number): this {
    return this.rotateAxis(1, 0, 0, rad);
  }

  rotateY(rad: number): this {
    return this.rotateAxis(0, 1, 0, rad);
  }

  rotateZ(rad: number): this {
    return this.rotateAxis(0, 0, 1, rad);
  }

  /** this = this * R(axis, rad)，axis 无需单位化。 */
  rotateAxis(axisX: number, axisY: number, axisZ: number, rad: number): this {
    const len = Math.hypot(axisX, axisY, axisZ);
    if (len < 1e-12) return this;
    const x = axisX / len;
    const y = axisY / len;
    const z = axisZ / len;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const t = 1 - c;
    const m = new Float32Array(16);
    m[0] = t * x * x + c;
    m[1] = t * x * y + s * z;
    m[2] = t * x * z - s * y;
    m[4] = t * x * y - s * z;
    m[5] = t * y * y + c;
    m[6] = t * y * z + s * x;
    m[8] = t * x * z + s * y;
    m[9] = t * y * z - s * x;
    m[10] = t * z * z + c;
    m[15] = 1;
    const e = this.elements;
    const tmp = new Float32Array(16);
    for (let c0 = 0; c0 < 4; c0++) {
      for (let r = 0; r < 4; r++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += e[k * 4 + r]! * m[c0 * 4 + k]!;
        }
        tmp[c0 * 4 + r] = sum;
      }
    }
    e.set(tmp);
    return this;
  }

  /** 欧拉旋转（弧度，外旋 Z→Y→X，等价于矩阵 Rz * Ry * Rx）。 */
  rotateEuler(xRad: number, yRad: number, zRad: number): this {
    const cx = Math.cos(xRad);
    const sx = Math.sin(xRad);
    const cy = Math.cos(yRad);
    const sy = Math.sin(yRad);
    const cz = Math.cos(zRad);
    const sz = Math.sin(zRad);
    const m = new Float32Array(16);
    m[0] = cy * cz;
    m[1] = cy * sz;
    m[2] = -sy;
    m[4] = sx * sy * cz - cx * sz;
    m[5] = sx * sy * sz + cx * cz;
    m[6] = sx * cy;
    m[8] = cx * sy * cz + sx * sz;
    m[9] = cx * sy * sz - sx * cz;
    m[10] = cx * cy;
    m[15] = 1;
    const e = this.elements;
    const tmp = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += e[k * 4 + r]! * m[c * 4 + k]!;
        }
        tmp[c * 4 + r] = sum;
      }
    }
    e.set(tmp);
    return this;
  }

  scale(x: number, y: number, z: number): this {
    const e = this.elements;
    e[0] *= x;
    e[1] *= x;
    e[2] *= x;
    e[3] *= x;
    e[4] *= y;
    e[5] *= y;
    e[6] *= y;
    e[7] *= y;
    e[8] *= z;
    e[9] *= z;
    e[10] *= z;
    e[11] *= z;
    return this;
  }

  /** 由平移/旋转/缩放组合出 TRS 矩阵（R 为 3x3 旋转矩阵，按列主序传入 9 个数）。 */
  static fromTRS(tx: number, ty: number, tz: number, rx3x3: Float32Array | number[], sx: number, sy: number, sz: number): Mat4 {
    const out = new Mat4();
    const e = out.elements;
    // 列0~2 = R 的列乘以各自缩放
    for (let c = 0; c < 3; c++) {
      const s = c === 0 ? sx : c === 1 ? sy : sz;
      e[c * 4] = rx3x3[c * 3]! * s;
      e[c * 4 + 1] = rx3x3[c * 3 + 1]! * s;
      e[c * 4 + 2] = rx3x3[c * 3 + 2]! * s;
    }
    e[3] = 0;
    e[7] = 0;
    e[11] = 0;
    e[12] = tx;
    e[13] = ty;
    e[14] = tz;
    e[15] = 1;
    return out;
  }

  static perspective(fovYRad: number, aspect: number, near: number, far: number): Mat4 {
    assertFinite(fovYRad, "fovY");
    assertFinite(aspect, "aspect");
    const out = new Mat4();
    const e = out.elements;
    const f = 1 / Math.tan(clamp(fovYRad, 1e-4, Math.PI - 1e-4) / 2);
    e.fill(0);
    e[0] = f / aspect;
    e[5] = f;
    e[10] = (far + near) / (near - far);
    e[11] = -1;
    e[14] = (2 * far * near) / (near - far);
    return out;
  }

  static ortho(left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
    const out = new Mat4();
    const e = out.elements;
    const lr = 1 / (right - left);
    const bt = 1 / (top - bottom);
    const nf = 1 / (near - far);
    e.fill(0);
    e[0] = 2 * lr;
    e[5] = 2 * bt;
    e[10] = 2 * nf;
    e[12] = -(right + left) * lr;
    e[13] = -(top + bottom) * bt;
    e[14] = (far + near) * nf;
    e[15] = 1;
    return out;
  }

  /** 观察矩阵（右手系，摄像机看向 -Z）。 */
  static lookAt(eyeX: number, eyeY: number, eyeZ: number, centerX: number, centerY: number, centerZ: number, upX = 0, upY = 1, upZ = 0): Mat4 {
    let zx = eyeX - centerX;
    let zy = eyeY - centerY;
    let zz = eyeZ - centerZ;
    let zl = Math.hypot(zx, zy, zz);
    if (zl < 1e-12) {
      zx = 0;
      zy = 0;
      zz = 1;
      zl = 1;
    }
    zx /= zl;
    zy /= zl;
    zz /= zl;

    let xx = upY * zz - upZ * zy;
    let xy = upZ * zx - upX * zz;
    let xz = upX * zy - upY * zx;
    let xl = Math.hypot(xx, xy, xz);
    if (xl < 1e-12) {
      xx = 1;
      xy = 0;
      xz = 0;
      xl = 1;
    }
    xx /= xl;
    xy /= xl;
    xz /= xl;

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    const out = new Mat4();
    const e = out.elements;
    e[0] = xx;
    e[1] = yx;
    e[2] = zx;
    e[3] = 0;
    e[4] = xy;
    e[5] = yy;
    e[6] = zy;
    e[7] = 0;
    e[8] = xz;
    e[9] = yz;
    e[10] = zz;
    e[11] = 0;
    e[12] = -(xx * eyeX + xy * eyeY + xz * eyeZ);
    e[13] = -(yx * eyeX + yy * eyeY + yz * eyeZ);
    e[14] = -(zx * eyeX + zy * eyeY + zz * eyeZ);
    e[15] = 1;
    return out;
  }

  /** 行列式（高斯消元，带部分主元）。 */
  determinant(): number {
    const a = new Float64Array(this.elements);
    let det = 1;
    for (let col = 0; col < 4; col++) {
      // 部分主元
      let pivot = col;
      for (let r = col + 1; r < 4; r++) {
        if (Math.abs(a[r * 4 + col]!) > Math.abs(a[pivot * 4 + col]!)) pivot = r;
      }
      if (Math.abs(a[pivot * 4 + col]!) < 1e-18) return 0;
      if (pivot !== col) {
        for (let c = col; c < 4; c++) {
          const tmp = a[col * 4 + c]!;
          a[col * 4 + c] = a[pivot * 4 + c]!;
          a[pivot * 4 + c] = tmp;
        }
        det = -det;
      }
      const p = a[col * 4 + col]!;
      det *= p;
      for (let r = col + 1; r < 4; r++) {
        const f = a[r * 4 + col]! / p;
        if (f === 0) continue;
        for (let c = col; c < 4; c++) {
          a[r * 4 + c] = a[r * 4 + c]! - f * a[col * 4 + c]!;
        }
      }
    }
    return det;
  }

  /** 原地求逆（高斯-约当）；不可逆时保持原样并返回 false。 */
  invert(): boolean {
    const m = this.elements;
    const a = new Float64Array(m);
    const inv = new Float64Array(16);
    for (let i = 0; i < 4; i++) inv[i * 4 + i] = 1;

    for (let col = 0; col < 4; col++) {
      let pivot = col;
      for (let r = col + 1; r < 4; r++) {
        if (Math.abs(a[r * 4 + col]!) > Math.abs(a[pivot * 4 + col]!)) pivot = r;
      }
      if (Math.abs(a[pivot * 4 + col]!) < 1e-18) return false;
      if (pivot !== col) {
        for (let c = 0; c < 4; c++) {
          const t = a[col * 4 + c]!;
          a[col * 4 + c] = a[pivot * 4 + c]!;
          a[pivot * 4 + c] = t;
          const u = inv[col * 4 + c]!;
          inv[col * 4 + c] = inv[pivot * 4 + c]!;
          inv[pivot * 4 + c] = u;
        }
      }
      const p = a[col * 4 + col]!;
      for (let c = 0; c < 4; c++) {
        a[col * 4 + c] = a[col * 4 + c]! / p;
        inv[col * 4 + c] = inv[col * 4 + c]! / p;
      }
      for (let r = 0; r < 4; r++) {
        if (r === col) continue;
        const f = a[r * 4 + col]!;
        if (f === 0) continue;
        for (let c = 0; c < 4; c++) {
          a[r * 4 + c] = a[r * 4 + c]! - f * a[col * 4 + c]!;
          inv[r * 4 + c] = inv[r * 4 + c]! - f * inv[col * 4 + c]!;
        }
      }
    }
    m.set(inv);
    return true;
  }

  static inverse(a: Mat4, out = new Mat4()): Mat4 | null {
    out.copy(a);
    return out.invert() ? out : null;
  }

  /** 连续写入目标 Float32Array（byteOffset 必须 4 字节对齐）。 */
  writeTo(out: Float32Array, byteOffset = 0): void {
    out.set(this.elements, byteOffset / 4);
  }

  equals(other: Mat4, epsilon = 1e-6): boolean {
    const a = this.elements;
    const b = other.elements;
    for (let i = 0; i < 16; i++) {
      if (Math.abs(a[i]! - b[i]!) > epsilon) return false;
    }
    return true;
  }

  toString(): string {
    const e = this.elements;
    const row = (r: number) => [e[r], e[4 + r], e[8 + r], e[12 + r]].map((v) => v!.toFixed(3)).join(", ");
    return `Mat4(\n  [${row(0)}]\n  [${row(1)}]\n  [${row(2)}]\n  [${row(3)}]\n)`;
  }
}
