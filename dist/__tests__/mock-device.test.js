/**
 * Mock 后端集成测试：验证“统一命令 + 资源抽象 + 高层材质”在不依赖 GPU 的情况下
 * 能够完整走通（记录 → 提交 → 状态模型断言）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockDevice } from "../device/createDevice.js";
import { MOCK_CANVAS_FORMAT } from "../device/backend/mock/MockDevice.js";
import { Color, Colors } from "../math/color.js";
import { Camera } from "../render/Camera.js";
import { ColorMaterial } from "../render/material.js";
import { Geometry } from "../render/Geometry.js";
import { box, triangle } from "../render/primitives.js";
import { Mesh } from "../render/Mesh.js";
import { TextureUsage } from "../gpu/types.js";
import { UnidrawError } from "../util/assert.js";
const VS = `#version 300 es
layout(location = 0) in vec3 a_position;
void main() { gl_Position = vec4(a_position, 1.0); }
`;
const FS = `#version 300 es
precision mediump float; out vec4 o; void main() { o = vec4(1.0); }
`;
const WGSL = `@vertex fn vs_main() -> @builtin(position) vec4f { return vec4f(0.0); }
@fragment fn fs_main() -> @location(0) vec4f { return vec4f(1.0); }`;
test("mock：全流程绘制一条 drawIndexed", () => {
    const device = createMockDevice();
    const program = device.createProgram({ label: "p", glsl: { vertex: VS, fragment: FS }, wgsl: { code: WGSL } });
    const layout = device.createBindGroupLayout({
        entries: [
            { binding: 0, type: "uniform-buffer", visibility: 3, name: "CameraBlock" },
            { binding: 1, type: "uniform-buffer", visibility: 3, name: "ModelBlock" },
        ],
    });
    const uboA = device.createBuffer({ size: 80, usage: 4 }); // UNIFORM
    const uboB = device.createBuffer({ size: 64, usage: 4 });
    const group = device.createBindGroup({
        layout,
        entries: [
            { binding: 0, resource: uboA },
            { binding: 1, resource: uboB },
        ],
    });
    const pipeline = device.createRenderPipeline({
        program,
        bindGroupLayouts: [layout],
        vertex: {
            buffers: [
                { arrayStride: 32, attributes: [{ location: 0, format: "float32x3", offset: 0 }] },
            ],
        },
        depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less-equal" },
        targets: [{ format: MOCK_CANVAS_FORMAT }],
    });
    const geo = Geometry.create(device, box());
    const encoder = device.createCommandEncoder("test");
    const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: null, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        depthStencilAttachment: { view: null, depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: 1 },
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.setVertexBuffer(0, geo.vertexBuffer);
    assert.ok(geo.indexBuffer && geo.indexFormat === "uint16");
    pass.setIndexBuffer(geo.indexBuffer, geo.indexFormat);
    pass.drawIndexed(geo.indexCount);
    pass.end();
    device.submit([encoder.finish()]);
    const calls = device.drawCalls;
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call.kind, "drawIndexed");
    assert.equal(call.draw.indexCount, 36);
    assert.equal(call.draw.instanceCount, 1);
    assert.equal(call.pipeline, pipeline);
    assert.equal(call.bindGroups[0], group);
    assert.equal(call.indexBuffer.format, "uint16");
    assert.equal(call.vertexBuffers.length, 1);
});
test("mock：验证命令级错误拦截", () => {
    const device = createMockDevice();
    const program = device.createProgram({ glsl: { vertex: VS, fragment: FS }, wgsl: { code: WGSL } });
    const layout = device.createBindGroupLayout({ entries: [{ binding: 0, type: "uniform-buffer", visibility: 3 }] });
    const pipeline = device.createRenderPipeline({
        program,
        bindGroupLayouts: [layout],
        vertex: { buffers: [{ arrayStride: 12, attributes: [{ location: 0, format: "float32x3", offset: 0 }] }] },
        targets: [{ format: MOCK_CANVAS_FORMAT }],
    });
    const vbo = device.createBuffer({ size: 12, usage: 1 });
    // 未 setPipeline 就 draw → 抛错
    {
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({ colorAttachments: [{ view: null, loadOp: "clear", storeOp: "store" }] });
        pass.setVertexBuffer(0, vbo);
        assert.throws(() => pass.draw(3), UnidrawError);
        pass.end();
        device.submit([enc.finish()]); // 即便 draw 失败，也不应破坏整体
    }
    // drawIndexed 未绑定索引 → 抛错
    {
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({ colorAttachments: [{ view: null, loadOp: "clear", storeOp: "store" }] });
        pass.setPipeline(pipeline);
        pass.setVertexBuffer(0, vbo);
        assert.throws(() => pass.drawIndexed(6), UnidrawError);
        pass.end();
        enc.finish();
    }
    // 未 end 的 pass 直接 finish → 抛错
    {
        const enc = device.createCommandEncoder();
        enc.beginRenderPass({ colorAttachments: [{ view: null, loadOp: "clear", storeOp: "store" }] });
        assert.throws(() => enc.finish(), UnidrawError);
    }
    // 绑定布局外 binding → 抛错
    assert.throws(() => {
        const group = device.createBindGroup({
            layout,
            entries: [{ binding: 5, resource: vbo }],
        });
        void group;
    }, UnidrawError);
});
test("mock：离屏渲染清屏到纯色", () => {
    const device = createMockDevice();
    const rt = device.createTexture({
        width: 4,
        height: 4,
        format: "rgba8unorm",
        usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.COPY_SRC | TextureUsage.TEXTURE_BINDING,
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
        colorAttachments: [
            { view: rt.view(), loadOp: "clear", storeOp: "store", clearValue: { r: 1, g: 0, b: 0, a: 0.5 } },
        ],
    });
    pass.end();
    device.submit([enc.finish()]);
    const pixels = device.readPixels(rt);
    assert.equal(pixels.length, 4 * 4 * 4);
    for (let i = 0; i < 4; i++) {
        assert.equal(pixels[i * 4], 255);
        assert.equal(pixels[i * 4 + 1], 0);
        assert.equal(pixels[i * 4 + 2], 0);
        assert.equal(pixels[i * 4 + 3], 128);
    }
});
test("mock + 高层材质：ColorMaterial 绘制 mesh", () => {
    const device = createMockDevice();
    const camera = new Camera();
    camera.aspect = 1;
    camera.distance = 5;
    camera.update();
    const material = new ColorMaterial(device, Colors.orange(), { cullMode: "none", depth: false, label: "mc" });
    const geo = Geometry.create(device, triangle());
    const mesh = new Mesh(geo);
    mesh.model.translate(0, 0, -3);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: null, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    material.beginFrame(camera.viewProjection);
    material.draw(pass, mesh);
    pass.end();
    device.submit([encoder.finish()]);
    const call = device.drawCalls[0];
    assert.equal(call.pipeline, material.pipelineHandle);
    assert.equal(call.kind, "draw");
    assert.equal(call.draw.vertexCount, 3);
    // Color 赋值往返
    const col = new Color(0.1, 0.2, 0.3, 0.9);
    material.setColor(col);
    assert.ok(material.color.equals(col, 1e-6));
    device.destroy();
});
test("mock：geometry 上传与索引类型选择", () => {
    const device = createMockDevice();
    // 小网格 → uint16
    const small = Geometry.create(device, box());
    assert.equal(small.indexFormat, "uint16");
    // 顶点超过 65535 → uint32（构造 70000 顶点球近似）
    const huge = {
        positions: [],
        normals: [],
        uvs: [],
        indices: [],
    };
    for (let i = 0; i < 70000; i++) {
        huge.positions.push(0, 0, i * 1e-6);
        huge.normals.push(0, 0, 1);
        huge.uvs.push(0, 0);
    }
    huge.indices.push(0, 1, 69999);
    const big = Geometry.create(device, huge);
    assert.equal(big.indexFormat, "uint32");
});
//# sourceMappingURL=mock-device.test.js.map