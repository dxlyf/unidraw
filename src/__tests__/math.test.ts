import { test } from "node:test";
import assert from "node:assert/strict";
import { Mat4 } from "../math/mat4.js";
import { Vec3, vec3Cross, vec3Dot } from "../math/vec3.js";
import { degToRad } from "../math/mmath.js";

test("mat4 multiply & identity", () => {
  const a = Mat4.identity().translate(1, 2, 3);
  const b = Mat4.identity().scale(2, 2, 2);
  const ab = Mat4.multiply(a, b);
  // ab = T * S：先缩放后平移（点会先被放大再平移）
  const origin = new Vec3(0, 0, 0);
  const e = ab.elements;
  assert.equal(e[12], 1);
  assert.equal(e[13], 2);
  assert.equal(e[14], 3);
  origin.applyMat4(ab);
  assert.deepEqual([origin.x, origin.y, origin.z], [1, 2, 3]);
});

test("mat4 inverse round-trip", () => {
  const m = Mat4.identity().translate(3, -1, 2).rotateY(degToRad(45)).scale(2, 3, 0.5);
  const inv = Mat4.inverse(m);
  assert.ok(inv, "矩阵应可逆");
  const product = Mat4.multiply(m, inv);
  const identity = Mat4.identity();
  assert.ok(product.equals(identity, 1e-5), `M * M^-1 应接近单位矩阵，实际:\n${product}`);
});

test("mat4 determinant matches invertibility", () => {
  const singular = new Mat4();
  singular.elements.fill(0);
  assert.ok(Math.abs(singular.determinant()) < 1e-9);
  assert.equal(singular.invert(), false);
  const m = Mat4.identity().scale(1, 2, 3);
  assert.ok(Math.abs(m.determinant() - 6) < 1e-6);
});

test("mat4 lookAt moves target to -Z axis", () => {
  const eye = new Vec3(0, 0, 10);
  const center = new Vec3(1, 1, 0);
  const distance = eye.distanceTo(center);
  const view = Mat4.lookAt(eye.x, eye.y, eye.z, center.x, center.y, center.z);
  const c = center.clone().applyMat4(view);
  assert.ok(Math.abs(c.x) < 1e-4 && Math.abs(c.y) < 1e-4, `center 应投影到 x/y=0，实际 ${c}`);
  assert.ok(Math.abs(c.z + distance) < 1e-4, `center 应位于 -distance，实际 z=${c.z}，distance=${distance}`);
});

test("mat4 perspective maps near plane", () => {
  const p = Mat4.perspective(degToRad(60), 1, 0.1, 100);
  const pt = new Vec3(0, 0, -0.1).applyMat4(p);
  // applyMat4 已执行透视除法，z 即 NDC z
  assert.ok(Math.abs(pt.z + 1) < 1e-4, `near 平面 NDC z 应为 -1，实际 ${pt.z}`);
});

test("vec3 dot/cross", () => {
  const a = new Vec3(1, 0, 0);
  const b = new Vec3(0, 1, 0);
  assert.equal(vec3Dot(a, b), 0);
  const c = vec3Cross(a, b);
  assert.ok(c.equals(new Vec3(0, 0, 1)));
  assert.equal(new Vec3(3, 4, 0).length(), 5);
});

test("vec3 applyMat4Dir ignores translation", () => {
  const m = Mat4.identity().translate(100, 0, 0).rotateZ(degToRad(90));
  const dir = new Vec3(1, 0, 0).applyMat4Dir(m);
  assert.ok(Math.abs(dir.x) < 1e-5 && Math.abs(dir.y - 1) < 1e-5, `应旋转到 +Y，实际 ${dir}`);
});
