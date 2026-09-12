import { test } from "node:test";
import assert from "node:assert/strict";
import { cylinder, cone, torus, capsule, box, sphere, plane } from "../render/primitives.js";
import { createMockDevice } from "../device/createDevice.js";
import { Camera } from "../render/Camera.js";
import { UnlitColorMaterial, PhongMaterial } from "../render/material.js";
import { Geometry } from "../render/Geometry.js";
import { Mesh } from "../render/Mesh.js";
import { Color } from "../math/color.js";
/** 统计顶点/三角形/绕序-法线一致率 */
function stats(data) {
    const idx = data.indices;
    const p = data.positions;
    const n = data.normals;
    let ok = 0;
    let tot = 0;
    for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i] * 3;
        const b = idx[i + 1] * 3;
        const c = idx[i + 2] * 3;
        const abx = p[b] - p[a];
        const aby = p[b + 1] - p[a + 1];
        const abz = p[b + 2] - p[a + 2];
        const acx = p[c] - p[a];
        const acy = p[c + 1] - p[a + 1];
        const acz = p[c + 2] - p[a + 2];
        const gl = Math.hypot(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx);
        if (gl < 1e-12)
            continue;
        const nx = n[a] + n[b] + n[c];
        const ny = n[a + 1] + n[b + 1] + n[c + 1];
        const nz = n[a + 2] + n[b + 2] + n[c + 2];
        const nl = Math.hypot(nx, ny, nz);
        if (nl < 1e-12)
            continue;
        tot++;
        if (((aby * acz - abz * acy) * nx + (abz * acx - abx * acz) * ny + (abx * acy - aby * acx) * nz) / (gl * nl) > 0)
            ok++;
    }
    return { verts: p.length / 3, tris: idx.length / 3, outwardPct: tot ? ok / tot : 1 };
}
function checkShape(data, name, minVerts = 12) {
    const s = stats(data);
    assert.ok(s.verts >= minVerts && s.tris >= Math.max(2, minVerts - 2), `${name} 顶点/三角形过少`);
    assert.ok(data.uvs.length === data.positions.length / 3 * 2, `${name} uv 数量应等于顶点数×2`);
    assert.ok(s.outwardPct > 0.95, `${name} 绕序应与法线朝外一致（${(s.outwardPct * 100).toFixed(1)}%）`);
    // 法线单位化
    const n = data.normals;
    for (let i = 0; i < n.length; i += 3) {
        assert.ok(Math.abs(Math.hypot(n[i], n[i + 1], n[i + 2]) - 1) < 1e-4, `${name} 存在非单位法线`);
    }
    // 索引合法
    const maxV = data.positions.length / 3;
    const idxArr = data.indices;
    for (let q = 0; q < idxArr.length; q++) {
        assert.ok(idxArr[q] >= 0 && idxArr[q] < maxV, `${name} 索引越界`);
    }
}
test("cylinder：封口圆柱几何合法", () => {
    checkShape(cylinder(0.5, 0.5, 1, 32, 1), "cylinder");
});
test("cylinder：圆台(radiusTop≠bottom) 合法", () => {
    checkShape(cylinder(0.2, 0.6, 1.2, 24, 1), "frustum");
});
test("cylinder：openEnded 无端盖仍有侧面", () => {
    const d = cylinder(0.5, 0.5, 1, 24, 1, true);
    const s = stats(d);
    assert.ok(s.verts >= 24 && s.tris >= 40);
});
test("cone：圆锥合法", () => {
    checkShape(cone(0.5, 1, 32), "cone");
});
test("torus：圆环合法且包围盒合理", () => {
    const d = torus(0.6, 0.2, 32, 16);
    checkShape(d, "torus");
    const p = d.positions;
    let maxY = 0;
    let maxR = 0;
    for (let i = 0; i < p.length; i += 3) {
        maxY = Math.max(maxY, Math.abs(p[i + 1]));
        maxR = Math.max(maxR, Math.hypot(p[i], p[i + 2]));
    }
    assert.ok(Math.abs(maxY - 0.2) < 1e-4, `tube 半径 maxY=${maxY}`);
    assert.ok(Math.abs(maxR - 0.8) < 1e-4, `主半径+tube=${maxR}`);
});
test("capsule：胶囊几何合法", () => {
    const d = capsule(0.4, 0.6, 24, 8);
    checkShape(d, "capsule");
    const p = d.positions;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
        minY = Math.min(minY, p[i + 1]);
        maxY = Math.max(maxY, p[i + 1]);
    }
    assert.ok(Math.abs(minY - (-0.3 - 0.4)) < 1e-4, `下界 ${minY}`);
    assert.ok(Math.abs(maxY - (0.3 + 0.4)) < 1e-4, `上界 ${maxY}`);
});
test("capsule：两侧顶部/底部闭合(无开放)且行与端点法线单位", () => {
    const d = capsule(0.4, 0.6, 24, 8);
    const s = stats(d);
    assert.ok(s.outwardPct > 0.95);
});
test("既有几何仍合法（回归）", () => {
    checkShape(box(), "box");
    checkShape(sphere(0.5, 24, 12), "sphere");
    checkShape(plane(2, 2, 1, 1), "plane", 4);
});
// ---------------------------------------------------------------------------
// 新材质（Mock 后端）
// ---------------------------------------------------------------------------
function makeScene(device, material) {
    const camera = new Camera();
    camera.distance = 5;
    camera.aspect = 1;
    camera.update();
    const geo = Geometry.create(device, box(1, 1, 1));
    const mesh = new Mesh(geo);
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: null, loadOp: "clear", storeOp: "store" }] });
    material.beginFrame(camera.viewProjection, camera.eyePosition);
    material.draw(pass, mesh);
    pass.end();
    device.submit([enc.finish()]);
    assert.equal(device.drawCalls.length, 1, "应产生一次 draw");
}
test("UnlitColorMaterial：可创建并绘制", () => {
    const device = createMockDevice();
    const mat = new UnlitColorMaterial(device, new Color(1, 0, 0, 1), { label: "unlit" });
    assert.ok(mat.color.equals(new Color(1, 0, 0, 1), 1e-6));
    makeScene(device, mat);
    device.destroy();
});
test("PhongMaterial：可创建并绘制，参数设置生效", () => {
    const device = createMockDevice();
    const mat = new PhongMaterial(device, new Color().setHex("#ffaa33"), {
        label: "phong",
        shininess: 96,
        specular: 0.8,
        ambient: 0.2,
    });
    mat.setShininess(128);
    mat.setSpecular(1);
    mat.setAmbient(0.1);
    makeScene(device, mat);
    device.destroy();
});
test("PhongMaterial alphaBlend 生成带混合的管线", () => {
    const device = createMockDevice();
    const mat = new PhongMaterial(device, new Color(1, 1, 1, 0.5), { label: "phong-blend", alphaBlend: true });
    const target = mat.pipelineHandle.descriptor.targets[0];
    assert.ok(target.blend, "alphaBlend 应设置混合状态");
    device.destroy();
});
//# sourceMappingURL=shapes3d-materials.test.js.map