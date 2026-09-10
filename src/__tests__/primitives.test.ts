import { test } from "node:test";
import assert from "node:assert/strict";
import { box, capsule, cone, cylinder, fullscreenTriangle, plane, sphere, torus, triangle } from "../render/primitives.js";
import type { GeometryData } from "../render/Geometry.js";

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

/**
 * 用散度定理算有符号体积：闭合网格 + 外向绕序 → 正值等于真实体积。
 * 这能同时抓住「面没放到正确平面」「绕序/法线朝内」这类几何 bug。
 */
function signedVolume(data: GeometryData): number {
  const pos = data.positions;
  const idx = data.indices;
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  let volume = 0;
  for (let f = 0; f < triCount; f++) {
    const i0 = (idx ? idx[f * 3]! : f * 3) * 3;
    const i1 = (idx ? idx[f * 3 + 1]! : f * 3 + 1) * 3;
    const i2 = (idx ? idx[f * 3 + 2]! : f * 3 + 2) * 3;
    const ax = pos[i0]!;
    const ay = pos[i0 + 1]!;
    const az = pos[i0 + 2]!;
    const bx = pos[i1]!;
    const by = pos[i1 + 1]!;
    const bz = pos[i1 + 2]!;
    const cx = pos[i2]!;
    const cy = pos[i2 + 1]!;
    const cz = pos[i2 + 2]!;
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return volume;
}

/** 每个顶点都应位于包围球内（球心在原点时即 |v| <= r） */
function outsideRadius(data: GeometryData, radius: number, tol = 1e-4): boolean {
  for (let i = 0; i < data.positions.length; i += 3) {
    const d = Math.hypot(data.positions[i]!, data.positions[i + 1]!, data.positions[i + 2]!);
    if (d > radius + tol) return true;
  }
  return false;
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

test("box：是真正的立方体（体积/面位置/绕序）", () => {
  const b = box(2, 3, 4);
  // 体积 = w*h*d（有符号体积为负说明绕序朝内 → 背面剔除会剔掉外面）
  const v = signedVolume(b);
  assert.ok(Math.abs(v - 24) < 1e-6, `体积应为 24，实际 ${v}`);
  // 每个顶点都必须在盒子的 8 个角上（±half 各分量）
  const { min, max } = bounds(b.positions);
  assert.deepEqual(min, [-1, -1.5, -2]);
  assert.deepEqual(max, [1, 1.5, 2]);
  for (let i = 0; i < b.positions.length; i += 3) {
    assert.ok(Math.abs(Math.abs(b.positions[i]!) - 1) < 1e-6, "x 分量必须是 ±width/2");
    assert.ok(Math.abs(Math.abs(b.positions[i + 1]!) - 1.5) < 1e-6, "y 分量必须是 ±height/2");
    assert.ok(Math.abs(Math.abs(b.positions[i + 2]!) - 2) < 1e-6, "z 分量必须是 ±depth/2");
  }
  // 法线：每个面的 4 个顶点法线一致，且与顶点位置同向（外向）
  for (let i = 0; i < b.positions.length; i += 3) {
    const nx = b.normals![i]!;
    const ny = b.normals![i + 1]!;
    const nz = b.normals![i + 2]!;
    const dot = nx * b.positions[i]! + ny * b.positions[i + 1]! + nz * b.positions[i + 2]!;
    assert.ok(dot > 0, "面法线必须朝外");
  }
});

test("内置几何：闭合体积与解析值一致（同时校验绕序朝外）", () => {
  // 多面体是解析形状的内接近似，误差随细分增大而减小 → 用相对容差
  const cases: { name: string; data: GeometryData; volume: number; relTol: number }[] = [
    { name: "box(1,1,1)", data: box(), volume: 1, relTol: 1e-6 },
    { name: "sphere(1,64,32)", data: sphere(1, 64, 32), volume: (4 / 3) * Math.PI, relTol: 0.01 },
    { name: "cylinder(0.5,0.5,2,64)", data: cylinder(0.5, 0.5, 2, 64), volume: Math.PI * 0.25 * 2, relTol: 0.01 },
    { name: "cone(0.5,2,64)", data: cone(0.5, 2, 64), volume: (Math.PI * 0.25 * 2) / 3, relTol: 0.01 },
    { name: "torus(1,0.25,64,32)", data: torus(1, 0.25, 64, 32), volume: 2 * Math.PI * Math.PI * 1 * 0.0625, relTol: 0.02 },
    {
      name: "capsule(0.4,1,48,16)",
      data: capsule(0.4, 1, 48, 16),
      volume: Math.PI * 0.16 * 1 + (4 / 3) * Math.PI * 0.064,
      relTol: 0.03,
    },
  ];
  for (const c of cases) {
    const v = signedVolume(c.data);
    const err = Math.abs(v - c.volume) / c.volume;
    assert.ok(
      err <= c.relTol,
      `${c.name} 体积应为 ${c.volume.toFixed(5)}（相对误差需 ≤ ${c.relTol}），实际 ${v.toFixed(5)}（误差 ${(err * 100).toFixed(2)}%）`,
    );
  }
  // 平面不是闭合体：两个三角形绕序一致（面积可算）即可
  const p = plane(2, 2);
  assert.equal(p.positions.length, 12);
});

test("内置几何：顶点不超出声明尺寸，法线单位化", () => {
  assert.ok(!outsideRadius(sphere(2, 32, 16), 2), "球体顶点不能超出半径");
  assert.ok(!outsideRadius(capsule(0.5, 2, 32, 12), 1.5 + 1e-4), "胶囊顶点不超过 r + h/2");
  const geos: GeometryData[] = [sphere(1, 24, 12), cylinder(0.7, 0.4, 1.4, 24), cone(0.6, 1.2, 24), torus(1, 0.3, 32, 16), capsule(0.4, 0.8, 24, 10)];
  for (const g of geos) {
    assert.ok(g.normals, "应带法线");
    for (let i = 0; i < g.normals!.length; i += 3) {
      const len = Math.hypot(g.normals![i]!, g.normals![i + 1]!, g.normals![i + 2]!);
      assert.ok(Math.abs(len - 1) < 1e-5, `法线必须单位长度，实际 ${len}`);
    }
    assert.ok(g.uvs && g.uvs.length === (g.positions.length / 3) * 2, "UV 数量应与顶点数匹配");
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
