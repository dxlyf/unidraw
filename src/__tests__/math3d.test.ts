/**
 * 3D 数学工具类的单元测试（对齐 three.js 的 math 模块）。
 *
 * 覆盖重点不是「方法能调用」，而是**恒等式与边界情况**：
 * - 旋转表示之间的往返（Euler ↔ Quaternion ↔ Mat4）必须闭合；
 * - `setFromUnitVectors` 的反向共线（180°）特例；
 * - 平面/AABB/球的相交判据在「明显在内 / 明显在外 / 恰好相切」三档上的行为；
 * - 退化输入（零长线段、退化三角形、极点）不产生 NaN。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Vec3 } from "../math/vec3.js";
import { Vec2 } from "../math/vec2.js";
import { Mat4 } from "../math/mat4.js";
import { Euler, DEFAULT_EULER_ORDER } from "../math/Euler.js";
import { Quaternion } from "../math/Quaternion.js";
import { Plane } from "../math/Plane.js";
import { Box3 } from "../math/Box3.js";
import { Box2 } from "../math/Box2.js";
import { Sphere } from "../math/Sphere.js";
import { Line3 } from "../math/Line3.js";
import { Triangle } from "../math/Triangle.js";
import { Cylindrical } from "../math/Cylindrical.js";
import { Spherical } from "../math/Spherical.js";
import { Frustum } from "../math/Frustum.js";
import { Ray } from "../math/Ray.js";

const EPS = 1e-5;
const vecClose = (a: Vec3, b: Vec3, eps = EPS): boolean =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps;
const quatClose = (a: Quaternion, b: Quaternion, eps = EPS): boolean =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps && Math.abs(a.w - b.w) < eps;

test("math: Euler → Quaternion → Euler 往返闭合（六种 order）", () => {
  assert.equal(DEFAULT_EULER_ORDER, "XYZ");
  const orders = ["XYZ", "YXZ", "ZXY", "ZYX", "YZX", "XZY"] as const;
  for (const order of orders) {
    const e = new Euler(0.3, -0.7, 1.1, order);
    const q = new Quaternion().setFromEuler(e);
    const back = new Euler().setFromQuaternion(q, order);
    assert.ok(
      Math.abs(back.x - e.x) < 1e-4 && Math.abs(back.y - e.y) < 1e-4 && Math.abs(back.z - e.z) < 1e-4,
      `${order} 往返应闭合：(0.3,-0.7,1.1) → ${back.x},${back.y},${back.z}`,
    );
  }
});

test("math: 单位四元数 / 轴角 / 旋转向量", () => {
  const identity = new Quaternion();
  assert.ok(quatClose(identity, new Quaternion(0, 0, 0, 1)));
  assert.ok(Math.abs(new Quaternion().length() - 1) < EPS);

  // 绕 Y 轴 90°：+X 应旋到 -Z
  const q = new Quaternion().setFromAxisAngle(new Vec3(0, 1, 0), Math.PI / 2);
  const rotated = new Vec3(1, 0, 0).applyQuaternion(q);
  assert.ok(vecClose(rotated, new Vec3(0, 0, -1), 1e-5), `+X 绕 Y 转 90° 应为 -Z，实际 ${rotated.toString()}`);

  // 逆旋转应还原
  const back = rotated.clone().applyQuaternion(q.clone().invert());
  assert.ok(vecClose(back, new Vec3(1, 0, 0)));

  // 与 Euler 的 applyEuler 一致
  const e = new Euler(0.2, Math.PI / 2, 0.4, "XYZ");
  const viaEuler = new Vec3(1, 0, 0).applyEuler(e);
  const viaQuat = new Vec3(1, 0, 0).applyQuaternion(new Quaternion().setFromEuler(e));
  assert.ok(vecClose(viaEuler, viaQuat, 1e-5), "applyEuler 与 applyQuaternion 必须一致");
});

test("math: Quaternion.setFromUnitVectors 含反向共线（180°）", () => {
  const q = new Quaternion().setFromUnitVectors(new Vec3(0, 0, 1), new Vec3(0, 0, 1));
  const v = new Vec3(0, 1, 0).applyQuaternion(q);
  assert.ok(vecClose(v, new Vec3(0, 1, 0)), "同向应为单位旋转");

  // 反向：需要一个 180° 旋转，且结果不能是 NaN
  const r = new Quaternion().setFromUnitVectors(new Vec3(0, 0, 1), new Vec3(0, 0, -1));
  const out = new Vec3(0, 0, 1).applyQuaternion(r);
  assert.ok(Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z), "反向共线不应产生 NaN");
  assert.ok(vecClose(out, new Vec3(0, 0, -1), 1e-4), `+Z 应被转到 -Z，实际 ${out.toString()}`);
});

test("math: Quaternion.slerp 端点与四元数夹角", () => {
  const a = new Quaternion();
  const b = new Quaternion().setFromAxisAngle(new Vec3(0, 1, 0), Math.PI / 2);
  const start = new Quaternion().slerp(b, 0);
  const end = new Quaternion().copy(a).slerp(b, 1);
  assert.ok(quatClose(start, a), "t=0 应等于起点");
  assert.ok(quatClose(end, b), "t=1 应等于终点");
  const mid = new Quaternion().copy(a).slerp(b, 0.5);
  assert.ok(Math.abs(a.angleTo(mid) - Math.PI / 4) < 1e-4, "中点夹角应为一半");
});

test("math: Mat4 ↔ Quaternion 往返（makeRotationFromQuaternion / decompose）", () => {
  const q = new Quaternion().setFromEuler(new Euler(0.4, -0.9, 0.25, "XYZ"));
  const m = new Mat4().makeRotationFromQuaternion(q);
  const back = new Quaternion().setFromRotationMatrix(m);
  assert.ok(quatClose(back, q, 1e-4), `Mat4 → Quaternion 应还原，实际 ${back.toString()}`);

  // compose / decompose 往返
  const pos = new Vec3(1.5, -2, 3);
  const scl = new Vec3(2, 0.5, 1.25);
  const composed = new Mat4().compose(pos, q, scl);
  const outPos = new Vec3();
  const outQuat = new Quaternion();
  const outScl = new Vec3();
  composed.decompose(outPos, outQuat, outScl);
  assert.ok(vecClose(outPos, pos, 1e-4), `位置应还原：${outPos.toString()}`);
  assert.ok(vecClose(outScl, scl, 1e-4), `缩放应还原：${outScl.toString()}`);
  assert.ok(quatClose(outQuat, q, 1e-4), "旋转应还原");
});

test("math: Plane 的距离 / 投影 / 与线求交", () => {
  const p = new Plane().setFromNormalAndCoplanarPoint(new Vec3(0, 1, 0), new Vec3(0, 2, 0));
  assert.ok(Math.abs(p.constant + 2) < EPS || Math.abs(p.constant - 2) < EPS, `constant 应为 ±2，实际 ${p.constant}`);
  assert.ok(Math.abs(p.distanceToPoint(new Vec3(5, 5, 5)) - 3) < 1e-5, "法线侧距离应为 3");
  assert.ok(Math.abs(p.distanceToPoint(new Vec3(0, -1, 0)) + 3) < 1e-5, "反侧距离应为 -3");

  const projected = p.projectPoint(new Vec3(7, 9, -4), new Vec3());
  assert.ok(vecClose(projected, new Vec3(7, 2, -4), 1e-5), `投影应落在平面上，实际 ${projected.toString()}`);

  // 与线段求交：穿过平面
  const line = new Line3().set(new Vec3(0, 0, 0), new Vec3(0, 4, 0));
  const hit = p.intersectLine(line, new Vec3());
  assert.ok(hit && vecClose(hit, new Vec3(0, 2, 0), 1e-5), "线段应命中 (0,2,0)");

  // 平行线段不应命中
  const parallel = new Line3().set(new Vec3(0, 5, 0), new Vec3(4, 5, 0));
  assert.equal(p.intersectLine(parallel, new Vec3()), null, "平行线段不应命中");
});

test("math: Box3 空盒 / 点集 / 相交 / 变换", () => {
  const empty = new Box3();
  assert.equal(empty.isEmpty(), true, "新建 Box3 应为空盒");
  const expanded = new Box3().makeEmpty().expandByPoint(new Vec3(1, 2, 3));
  assert.equal(expanded.isEmpty(), false);
  assert.ok(vecClose(expanded.min, new Vec3(1, 2, 3)) && vecClose(expanded.max, new Vec3(1, 2, 3)));

  const box = new Box3().setFromPoints([new Vec3(-1, -2, -3), new Vec3(3, 4, 5)]);
  const center = box.getCenter(new Vec3());
  const size = box.getSize(new Vec3());
  assert.ok(vecClose(center, new Vec3(1, 1, 1)), `中心应为 (1,1,1)，实际 ${center.toString()}`);
  assert.ok(vecClose(size, new Vec3(4, 6, 8)), `尺寸应为 (4,6,8)，实际 ${size.toString()}`);
  assert.equal(box.containsPoint(new Vec3(0, 0, 0)), true);
  assert.equal(box.containsPoint(new Vec3(3.5, 0, 0)), false);
  assert.ok(Math.abs(box.distanceToPoint(new Vec3(5, 1, 1)) - 2) < 1e-5, "到 x=5 的距离应为 2");

  const sphere = box.getBoundingSphere(new Sphere());
  assert.ok(Math.abs(sphere.radius - Math.hypot(2, 3, 4)) < 1e-5, `包围球半径应为半对角线，实际 ${sphere.radius}`);
  assert.equal(sphere.intersectsBox(box), true);

  // 平移矩阵应平移包围盒
  const moved = box.clone().applyMatrix4(new Mat4().translate(10, 0, 0));
  assert.ok(vecClose(moved.getCenter(new Vec3()), new Vec3(11, 1, 1), 1e-4), "平移后中心应 +10");

  // 两个盒的相交/并集
  const other = new Box3(new Vec3(2, 2, 2), new Vec3(6, 6, 6));
  assert.equal(box.intersectsBox(other), true);
  const merged = box.clone().union(other);
  assert.ok(vecClose(merged.max, new Vec3(6, 6, 6)), "并集上界应为 (6,6,6)");
});

test("math: Box2 基础与相交", () => {
  const box = new Box2().makeEmpty();
  assert.equal(box.isEmpty(), true, "新建/清空后的 Box2 应为空盒");
  box.setFromPoints([new Vec2(-1, -1), new Vec2(2, 3)]);
  assert.equal(box.isEmpty(), false);
  const c = box.getCenter(new Vec2());
  assert.ok(Math.abs(c.x - 0.5) < 1e-6 && Math.abs(c.y - 1) < 1e-6, `中心应为 (0.5,1)，实际 ${c.x},${c.y}`);
  const size = box.getSize(new Vec2());
  assert.ok(Math.abs(size.x - 3) < 1e-6 && Math.abs(size.y - 4) < 1e-6, `尺寸应为 (3,4)，实际 ${size.x},${size.y}`);
  assert.equal(box.containsPoint(new Vec2(0, 0)), true);
  assert.equal(box.containsPoint(new Vec2(3, 0)), false);
  assert.equal(box.intersectsBox(new Box2(new Vec2(1, 1), new Vec2(5, 5))), true);
  assert.equal(box.intersectsBox(new Box2(new Vec2(10, 10), new Vec2(12, 12))), false);
  assert.ok(Math.abs(box.distanceToPoint(new Vec2(5, 1)) - 3) < 1e-5, "到 x=5 的距离应为 3");
  const moved = box.clone().translate(new Vec2(10, 0));
  assert.ok(Math.abs(moved.min.x - 9) < 1e-6, "平移后 min.x 应为 9");
});

test("math: Sphere 的点集拟合与相交判据", () => {
  const pts = [new Vec3(-1, 0, 0), new Vec3(1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, -1, 0)];
  const s = new Sphere().setFromPoints(pts);
  assert.ok(Math.abs(s.radius - 1) < 1e-5, `半径应为 1，实际 ${s.radius}`);
  assert.ok(s.center.length() < 1e-5, `中心应接近原点，实际 ${s.center.toString()}`);
  assert.equal(s.containsPoint(new Vec3(0.5, 0, 0)), true);
  assert.equal(s.containsPoint(new Vec3(2, 0, 0)), false);
  assert.ok(Math.abs(s.distanceToPoint(new Vec3(3, 0, 0)) - 2) < 1e-5);

  // 与平面：切到/远离
  const plane = new Plane().setFromNormalAndCoplanarPoint(new Vec3(0, 1, 0), new Vec3(0, 0.5, 0));
  assert.equal(s.intersectsPlane(plane), true, "平面距球心 0.5 < r=1 应相交");
  const far = new Plane().setFromNormalAndCoplanarPoint(new Vec3(0, 1, 0), new Vec3(0, 5, 0));
  assert.equal(s.intersectsPlane(far), false, "平面距球心 5 > r=1 不应相交");

  // 与盒
  assert.equal(s.intersectsBox(new Box3(new Vec3(0.9, -0.1, -0.1), new Vec3(3, 0.1, 0.1))), true);
  assert.equal(s.intersectsBox(new Box3(new Vec3(2, 2, 2), new Vec3(3, 3, 3))), false);
});

test("math: Line3 最近点与退化（起终点重合）", () => {
  const line = new Line3().set(new Vec3(0, 0, 0), new Vec3(10, 0, 0));
  const cp = line.closestPointToPoint(new Vec3(3, 5, 0), true, new Vec3());
  assert.ok(vecClose(cp, new Vec3(3, 0, 0), 1e-5), `最近点应为 (3,0,0)，实际 ${cp.toString()}`);
  assert.ok(Math.abs(line.distanceSq() - 100) < 1e-5);

  const degenerate = new Line3().set(new Vec3(1, 2, 3), new Vec3(1, 2, 3));
  const p = degenerate.closestPointToPoint(new Vec3(5, 5, 5), true, new Vec3());
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), "退化线段不应产生 NaN");
  assert.ok(vecClose(p, new Vec3(1, 2, 3), 1e-5), "退化线段最近点应为该点自身");
});

test("math: Triangle 法线 / 重心坐标 / 包含判定", () => {
  const tri = new Triangle().set(new Vec3(0, 0, 0), new Vec3(1, 0, 0), new Vec3(0, 1, 0));
  const n = tri.getNormal(new Vec3());
  assert.ok(vecClose(n, new Vec3(0, 0, 1), 1e-5), `法线应为 +Z，实际 ${n.toString()}`);
  assert.ok(tri.containsPoint(new Vec3(0.25, 0.25, 0)), "内部点应被判定为包含");
  assert.equal(tri.containsPoint(new Vec3(0.9, 0.9, 0)), false);

  const bary = tri.getBarycoord(new Vec3(0.25, 0.25, 0), new Vec3());
  assert.ok(Math.abs(bary.x + bary.y + bary.z - 1) < 1e-5, "重心坐标之和应为 1");

  // 平面上方点的最近点应落到三角形内
  const cp = tri.closestPointToPoint(new Vec3(0.2, 0.2, 3), new Vec3());
  assert.ok(Math.abs(cp.z) < 1e-5, "最近点应落在 z=0 平面上");
});

test("math: Cylindrical / Spherical 与直角坐标往返", () => {
  const v = new Vec3(3, 4, -2);
  const c = new Cylindrical().setFromVector3(v);
  assert.ok(Math.abs(c.y - 4) < 1e-5, "柱坐标 y 分量应保持");
  assert.ok(Math.abs(c.radius - Math.hypot(3, -2)) < 1e-5, "柱坐标半径应为 XZ 平面距离");
  const backC = new Vec3().setFromCylindrical(c);
  assert.ok(vecClose(backC, v, 1e-5), `柱坐标往返应还原，实际 ${backC.toString()}`);

  const s = new Spherical().setFromVector3(v);
  assert.ok(Math.abs(s.radius - v.length()) < 1e-5, "球坐标半径应为向量长度");
  const backS = new Vec3().setFromSpherical(s);
  assert.ok(vecClose(backS, v, 1e-5), `球坐标往返应还原，实际 ${backS.toString()}`);

  // 极点附近 makeSafe 不应产生 NaN
  const pole = new Spherical().setFromVector3(new Vec3(0, 5, 0)).makeSafe();
  assert.ok(Number.isFinite(pole.phi) && Number.isFinite(pole.theta), "极点 makeSafe 后不应 NaN");
});

test("math: Frustum 从投影矩阵提取，内外点与球判定", () => {
  const proj = Mat4.perspective(Math.PI / 3, 1, 0.1, 100);
  const frustum = new Frustum().setFromProjectionMatrix(proj, true);

  assert.equal(frustum.containsPoint(new Vec3(0, 0, -5)), true, "视锥内前方点应被包含");
  assert.equal(frustum.containsPoint(new Vec3(0, 0, 5)), false, "相机后方点不应被包含");
  assert.equal(frustum.containsPoint(new Vec3(0, 0, -200)), false, "超出 far 不应被包含");

  assert.equal(frustum.intersectsSphere(new Vec3(0, 0, -5), 1), true);
  assert.equal(frustum.intersectsSphere(new Vec3(50, 0, -5), 1), false, "远处侧向球不应相交");
  assert.equal(frustum.intersectsBox(new Box3(new Vec3(-1, -1, -6), new Vec3(1, 1, -4))), true);
  assert.equal(frustum.intersectsBox(new Box3(new Vec3(30, 30, -6), new Vec3(31, 31, -4))), false);
});

test("math: Ray 求交（球 / AABB / 三角形）回归", () => {
  const ray = new Ray().set(new Vec3(0, 0, 10), new Vec3(0, 0, -1));
  assert.ok(Math.abs((ray.intersectSphere(new Vec3(0, 0, 0), 2) ?? -1) - 8) < 1e-5, "球面入口 t 应为 8");
  assert.ok(Math.abs((ray.intersectAABB(new Vec3(-1, -1, -1), new Vec3(1, 1, 1)) ?? -1) - 9) < 1e-5, "AABB 入口 t 应为 9");
  const t = ray.intersectTriangle(new Vec3(-1, -1, 0), new Vec3(1, -1, 0), new Vec3(0, 1, 0));
  assert.ok(t !== null && Math.abs(t - 10) < 1e-5, "三角形命中 t 应为 10");
  assert.equal(ray.intersectSphere(new Vec3(0, 0, 0), 2) !== null, true);
  const miss = new Ray().set(new Vec3(0, 10, 10), new Vec3(0, 0, -1));
  assert.equal(miss.intersectSphere(new Vec3(0, 0, 0), 2), null, "偏离的射线不应命中");
});
