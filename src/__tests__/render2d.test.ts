import { test } from "node:test";
import assert from "node:assert/strict";
import { Path2D } from "../render2d/path.js";
import { triangulateSimplePolygon, polygonArea2 } from "../render2d/triangulate.js";
import { transformPoint, identityAffine, multiplyAffine, type Affine } from "../render2d/matrix.js";
import { Color } from "../math/color.js";
import { LinearGradient, sampleStyle } from "../render2d/style.js";

function ptsClose(p: readonly [number, number], q: readonly [number, number], eps = 1e-6): boolean {
  return Math.abs(p[0] - q[0]) < eps && Math.abs(p[1] - q[1]) < eps;
}

test("path: rect 压平为单个闭合轮廓(4点)", () => {
  const p = new Path2D();
  p.rect(10, 20, 100, 50);
  const cs = p.flatten(0.5);
  assert.equal(cs.length, 1);
  assert.equal(cs[0]!.closed, true);
  assert.equal(cs[0]!.points.length, 4);
  assert.ok(ptsClose(cs[0]!.points[0]!, [10, 20]));
  assert.ok(ptsClose(cs[0]!.points[2]!, [110, 70]));
});

test("path: roundRect 生成圆角轮廓（角点被圆弧替代）", () => {
  const p = new Path2D();
  p.roundRect(0, 0, 100, 80, 10);
  const cs = p.flatten(0.5);
  assert.equal(cs.length, 1);
  assert.equal(cs[0]!.closed, true);
  const pts = cs[0]!.points;
  assert.ok(pts.length > 4, "圆角矩形应有圆弧细分点");
  // 轮廓都应落在矩形范围内（半径≤min/2）
  for (const pt of pts) {
    assert.ok(pt[0] >= 0 && pt[0] <= 100, `x 越界 ${pt[0]}`);
    assert.ok(pt[1] >= 0 && pt[1] <= 80, `y 越界 ${pt[1]}`);
  }
});

test("path: 三次贝塞尔终点可达，且压平点数足够", () => {
  const p = new Path2D();
  p.moveTo(0, 0);
  p.bezierCurveTo(0, 40, 40, 40, 40, 0);
  const cs = p.flatten(0.2);
  const last = cs[0]!.points[cs[0]!.points.length - 1]!;
  assert.ok(ptsClose(last, [40, 0], 1e-4));
  assert.ok(cs[0]!.points.length >= 8, "曲线应细分");
});

test("path: arc 圆弧半径与角度范围正确", () => {
  const p = new Path2D();
  p.moveTo(100, 0);
  p.arc(0, 0, 100, 0, Math.PI / 2, false);
  const cs = p.flatten(0.2);
  const pts = cs[0]!.points;
  for (const [x, y] of pts) {
    const r = Math.hypot(x, y);
    assert.ok(Math.abs(r - 100) < 0.1, `半径 ${r}`);
    assert.ok(x >= -0.01 && y >= -0.01, "90° 范围内");
  }
});

test("triangulate: 矩形面积为三角形面积和", () => {
  const square: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ];
  assert.ok(Math.abs(polygonArea2(square) - 32) < 1e-9);
  const tris = triangulateSimplePolygon(square)!;
  assert.equal(tris.length, (square.length - 2) * 3);
  // 各三角形面积之和 ≈ 16（绝对值求和）
  let sum = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const [ax, ay] = square[tris[i]!]!;
    const [bx, by] = square[tris[i + 1]!]!;
    const [cx2, cy2] = square[tris[i + 2]!]!;
    sum += Math.abs((ax * (by - cy2) + bx * (cy2 - ay) + cx2 * (ay - by)) / 2);
  }
  assert.ok(Math.abs(sum - 16) < 1e-6);
});

test("triangulate: 凹多边形（L 形）也能三角化且面积守恒", () => {
  const lShape: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 1],
    [1, 1],
    [1, 4],
    [0, 4],
  ];
  const tris = triangulateSimplePolygon(lShape)!;
  assert.ok(tris.length >= 3, "L 形至少拆出若干三角形");
  let sum = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const [ax, ay] = lShape[tris[i]!]!;
    const [bx, by] = lShape[tris[i + 1]!]!;
    const [cx2, cy2] = lShape[tris[i + 2]!]!;
    sum += Math.abs((ax * (by - cy2) + bx * (cy2 - ay) + cx2 * (ay - by)) / 2);
  }
  // L 形面积 7
  assert.ok(Math.abs(sum - 7) < 1e-6);
});

test("triangulate: 星形（凹）能正常返回三角形", () => {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 5 : 2;
    const a = (i / 10) * Math.PI * 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const tris = triangulateSimplePolygon(pts);
  assert.ok(tris && tris.length > 3);
});

test("matrix: translate + rotate 组合与旋转保距", () => {
  const ctm: Affine = identityAffine();
  multiplyAffine(ctm, { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 }, ctm);
  multiplyAffine(ctm, { a: Math.cos(0.5), b: Math.sin(0.5), c: -Math.sin(0.5), d: Math.cos(0.5), e: 0, f: 0 }, ctm);
  const p = transformPoint(ctm, 1, 0, { x: 0, y: 0 });
  const len = Math.hypot(p.x - 10, p.y - 20);
  assert.ok(Math.abs(len - 1) < 1e-9, "旋转保持长度");
});

test("style: 纯色与线性渐变端点采样", () => {
  const solid = new Color(1, 0, 0, 1);
  const c1 = sampleStyle(solid, 0, 0);
  assert.ok(Math.abs(c1.r - 1) < 1e-9 && Math.abs(c1.g) < 1e-9);
  const grad = new LinearGradient(0, 0, 10, 0);
  grad.addColorStop(0, "#000000");
  grad.addColorStop(1, "#ffffff");
  const c0 = sampleStyle(grad, 0, 0);
  const c1b = sampleStyle(grad, 10, 0);
  const cm = sampleStyle(grad, 5, 0);
  assert.ok(c0.r < 0.05 && c1b.r > 0.95 && Math.abs(cm.r - 0.5) < 0.1);
});
