/**
 * 程序 / 管线内容缓存测试。
 *
 * 目的：同构材质（同一套着色器 + 同样的管线状态）不应重复创建原生资源；
 * 不同状态必须得到不同管线（否则渲染会串状态）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockDevice } from "../device/createDevice.js";
import { ColorMaterial, PhongMaterial, UnlitColorMaterial } from "../render/material.js";
import { Color } from "../math/color.js";
import { STANDARD_VERTEX_STATE } from "../render/materialCommon.js";
import { ColorWriteMask } from "../device/descriptors.js";
import { hashString, pipelineCacheKey, programCacheKey } from "../device/resourceCache.js";
import { Camera } from "../render/Camera.js";
import { Mesh } from "../render/Mesh.js";
import { Geometry } from "../render/Geometry.js";
import { box } from "../render/primitives.js";
import { BufferUsage } from "../gpu/types.js";
const GLSL = {
    vertex: `#version 300 es
void main() {}`,
    fragment: `#version 300 es
precision highp float;
out vec4 c;
void main() { c = vec4(1.0); }`,
};
function descriptor(program) {
    return {
        program,
        bindGroupLayouts: [],
        vertex: STANDARD_VERTEX_STATE,
        primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
        depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less-equal" },
        targets: [{ format: "rgba8unorm", writeMask: ColorWriteMask.ALL }],
    };
}
test("缓存键：源码/状态相同 → 键相同，不同 → 键不同", () => {
    const device = createMockDevice();
    const a = device.createProgram({ glsl: { vertex: GLSL.vertex, fragment: GLSL.fragment } });
    const b = device.createProgram({ label: "另一个 label（不影响内容）", glsl: { vertex: GLSL.vertex, fragment: GLSL.fragment } });
    assert.equal(a, b, "源码相同的程序共享实例");
    const c = device.createProgram({ glsl: { vertex: GLSL.vertex, fragment: GLSL.fragment.replace("1.0", "0.5") } });
    assert.notEqual(a, c, "片元源码不同 → 不同程序");
    const base = descriptor(a);
    const key = pipelineCacheKey(base, 1);
    assert.equal(pipelineCacheKey({ ...base, label: "x" }, 1), key, "label 不参与管线指纹");
    assert.notEqual(pipelineCacheKey(descriptor(c), 2), key, "程序 id 不同 → 管线指纹不同");
    assert.notEqual(pipelineCacheKey({ ...base, primitive: { ...base.primitive, cullMode: "front" } }, 1), key, "剔除模式不同 → 不同管线");
    assert.notEqual(pipelineCacheKey({ ...base, depthStencil: { ...base.depthStencil, depthCompare: "always" } }, 1), key, "深度比较不同 → 不同管线");
    assert.notEqual(pipelineCacheKey({ ...base, targets: [] }, 1), key, "颜色目标不同（只写深度）→ 不同管线");
    assert.notEqual(pipelineCacheKey({ ...base, multisample: { count: 4 } }, 1), key, "采样数不同 → 不同管线");
    assert.equal(hashString("abc"), hashString("abc"));
    assert.notEqual(hashString("abc"), hashString("abd"));
    assert.ok(programCacheKey({ label: "x", glsl: { vertex: "a", fragment: "b" } }).length > 0);
});
test("管线缓存：同状态共享，状态不同各自创建", () => {
    const device = createMockDevice();
    const program = device.createProgram({ glsl: { vertex: GLSL.vertex, fragment: GLSL.fragment } });
    const p1 = device.createRenderPipeline(descriptor(program));
    const p2 = device.createRenderPipeline(descriptor(program));
    assert.equal(p1, p2, "同状态管线共享实例");
    assert.equal(device.pipelinesCreated, 1);
    const p3 = device.createRenderPipeline({ ...descriptor(program), primitive: { topology: "triangle-list", cullMode: "none", frontFace: "ccw" } });
    assert.notEqual(p3, p1);
    assert.equal(device.pipelinesCreated, 2);
    // 缓存项被销毁后应重新创建（不会返回已销毁资源）
    p1.destroy();
    const p4 = device.createRenderPipeline(descriptor(program));
    assert.notEqual(p4, p1);
    assert.equal(p4.destroyed, false);
});
test("同构内置材质：共享程序与管线（25 个球只编译一次）", () => {
    const device = createMockDevice();
    const before = { programs: device.programsCreated, pipelines: device.pipelinesCreated };
    const materials = [];
    for (let i = 0; i < 25; i++) {
        materials.push(new ColorMaterial(device, new Color(0.5, 0.5, 0.5, 1), { label: `ball-${i}` }));
    }
    assert.equal(device.programsCreated - before.programs, 1, "25 个同构材质只创建一个程序");
    assert.equal(device.pipelinesCreated - before.pipelines, 1, "25 个同构材质只创建一条管线");
    assert.equal(materials[0].pipelineHandle, materials[24].pipelineHandle);
    // 不同着色器 / 不同状态各自独立
    const extra = [
        new PhongMaterial(device, new Color(1, 1, 1, 1), { label: "phong" }),
        new UnlitColorMaterial(device, new Color(1, 1, 1, 1), { label: "unlit" }),
        new ColorMaterial(device, new Color(1, 1, 1, 1), { label: "blend", alphaBlend: true }),
        new ColorMaterial(device, new Color(1, 1, 1, 1), { label: "no-depth", depth: false }),
        new ColorMaterial(device, new Color(1, 1, 1, 1), { label: "rt", targetFormat: "rgba8unorm" }),
    ];
    assert.equal(device.programsCreated - before.programs, 3, "Color/Phong/Unlit 三种着色器");
    const pipelines = new Set(extra.map((m) => m.pipelineHandle));
    assert.equal(pipelines.size, extra.length, "状态不同的材质各自一条管线");
    // 未传 targetFormat 的材质用画布格式；显式 rgba8unorm 且画布也是 rgba8unorm → 与 base 管线相同
    assert.equal(extra[4].pipelineHandle, materials[0].pipelineHandle, "格式等价时仍复用同一条管线");
});
test("动态偏移按值内联：逐 draw 复用数组、环形槽正确", () => {
    const device = createMockDevice();
    const shared = new ColorMaterial(device, new Color(1, 1, 1, 1), { label: "shared", modelRingSlots: 4 });
    const meshes = [];
    for (let i = 0; i < 3; i++) {
        const mesh = new Mesh(Geometry.create(device, box(1, 1, 1)));
        mesh.setPosition(i * 2, 0, 0);
        mesh.material = shared;
        meshes.push(mesh);
    }
    const camera = new Camera();
    camera.distance = 8;
    camera.pitch = 0.3;
    camera.update();
    const pass = device.createCommandEncoder("ring").beginRenderPass({
        colorAttachments: [{ view: null, loadOp: "clear", storeOp: "store" }],
        depthStencilAttachment: null,
    });
    shared.beginFrame(camera.viewProjection, camera.eyePosition);
    for (const mesh of meshes)
        shared.draw(pass, mesh);
    pass.end();
    device.submit([device.createCommandEncoder("dummy").finish()]);
    device.submit([device.createCommandEncoder("ring-commit").finish()]);
    const encoder = device.createCommandEncoder("ring2");
    const p = encoder.beginRenderPass({ colorAttachments: [{ view: null }], depthStencilAttachment: null });
    shared.beginFrame(camera.viewProjection, camera.eyePosition);
    for (const mesh of meshes)
        shared.draw(p, mesh);
    p.end();
    device.submit([encoder.finish()]);
    const offsets = device.drawCalls.map((c) => c.bindGroupOffsets[0]?.[0]);
    const stride = offsets[1] - offsets[0];
    assert.deepEqual(offsets, [0, stride, 2 * stride], "共享材质 3 次绘制落在不同环形槽");
    // 调用方数组随后被改写不影响已记录命令（值已内联复制）
    const layout = device.createBindGroupLayout({
        entries: [{ binding: 0, type: "uniform-buffer", visibility: 1, name: "B", hasDynamicOffset: true }],
    });
    const ubo = device.createBuffer({ label: "dyn-ubo", size: 512, usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST });
    const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: ubo, offset: 0, size: 256 }] });
    const enc = device.createCommandEncoder("inline");
    const pass2 = enc.beginRenderPass({ colorAttachments: [{ view: null }], depthStencilAttachment: null });
    const caller = [256];
    pass2.setBindGroup(0, group, caller);
    caller[0] = 0;
    pass2.end();
    const op = enc.finish().ops.find((o) => o.k === "setBindGroup");
    assert.ok(op && op.k === "setBindGroup");
    assert.equal(op.offset0, 256, "偏移按值保存");
    assert.equal(op.offsetCount, 1);
    // 超过上限必须报错而不是静默截断
    const enc2 = device.createCommandEncoder("too-many");
    const pass3 = enc2.beginRenderPass({ colorAttachments: [{ view: null }], depthStencilAttachment: null });
    let threw = false;
    try {
        pass3.setBindGroup(0, group, [0, 0, 0]);
    }
    catch (e) {
        threw = e instanceof Error && /动态偏移最多/.test(e.message);
    }
    assert.ok(threw, "超过动态偏移上限应报错");
    pass3.end();
});
//# sourceMappingURL=resource-cache.test.js.map