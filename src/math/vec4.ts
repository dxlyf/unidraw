import { equals as numEquals } from "./mmath.js";

export class Vec4 {
  x: number;
  y: number;
  z: number;
  w: number;

  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  static zero(): Vec4 {
    return new Vec4(0, 0, 0, 0);
  }

  set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }

  copy(v: Vec4): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    this.w = v.w;
    return this;
  }

  clone(): Vec4 {
    return new Vec4(this.x, this.y, this.z, this.w);
  }

  add(v: Vec4): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    this.w += v.w;
    return this;
  }

  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    this.w *= s;
    return this;
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  equals(v: Vec4, epsilon?: number): boolean {
    return (
      numEquals(this.x, v.x, epsilon) &&
      numEquals(this.y, v.y, epsilon) &&
      numEquals(this.z, v.z, epsilon) &&
      numEquals(this.w, v.w, epsilon)
    );
  }

  /** 连续写入 Float32Array（用于 uniform/顶点上传）。 */
  writeTo(out: Float32Array, byteOffset = 0): void {
    out[byteOffset / 4] = this.x;
    out[byteOffset / 4 + 1] = this.y;
    out[byteOffset / 4 + 2] = this.z;
    out[byteOffset / 4 + 3] = this.w;
  }

  toString(): string {
    return `Vec4(${this.x}, ${this.y}, ${this.z}, ${this.w})`;
  }
}

export function vec4Dot(a: Vec4, b: Vec4): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}
