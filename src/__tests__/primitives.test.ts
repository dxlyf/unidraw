import { test } from "node:test";
import assert from "node:assert/strict";
import { box, plane, sphere, triangle, fullscreenTriangle } from "../render/primitives.js";

function bounds(positions: ArrayLike<number>): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k]!;
      min[k] = Math.min(min[k]!, v);
      max[k] = Math.max(max[k]!, v);
    }
  }
  return { min, max };
}

test("box：24 顶点 / 36 索引 / 包围盒 ±0.5", () => {
  const b = box();
  assert.equal(b.positions.length, 24 * 3);
  assert.equal(b.normals!.length, 24 * 3);
  assert.equal(b.uvs!.length, 24 * 2);
  const indexArr = Array.from(b.indices!);
  assert.equal(indexArr.length, 36);
  assert.equal(Math.max(...indexArr), 23, "索引最大不超过 24 顶点");
  assert.equal(Math.min(...indexArr), 0);
  const { min, max } = bounds(b.positions);
  assert.deepEqual(min, [-0.5, -0.5, -0.5]);
  assert.deepEqual(max, [0.5, 0.5, 0.5]);
  // 法线应全部单位化
  for (let i = 0; i < b.normals!.length; i += 3) {
    const x = b.normals![i]!;
    const y = b.normals![i + 1]!;
    const z = b.normals![i + 2]!;
    assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-6, "法线必须单位长度");
  }
});

test("plane：默认 4 顶点 6 索引", () => {
  const p = plane(2, 2);
  assert.equal(p.positions.length, 4 * 3);
  assert.equal(p.indices!.length, 6);
});

test("sphere：半径与顶点合法性", () => {
  const s = sphere(2, 12, 6);
  assert.equal(s.positions.length, s.normals!.length);
  const { max } = bounds(s.positions);
  assert.ok(max[0]! <= 2 + 1e-6 && max[1]! <= 2 + 1e-6 && max[2]! <= 2 + 1e-6, "球体不能超出半径");
  for (let i = 0; i < s.normals!.length; i += 3) {
    assert.ok(Math.abs(Math.hypot(s.normals![i]!, s.normals![i + 1]!, s.normals![i + 2]!) - 1) < 1e-6);
  }
});

test("triangle / fullscreenTriangle 非索引", () => {
  const t = triangle();
  assert.equal(t.positions.length, 9);
  assert.equal(t.indices, undefined);
  const f = fullscreenTriangle();
  assert.equal(f.positions.length, 9);
  assert.equal(f.indices, undefined);
});
