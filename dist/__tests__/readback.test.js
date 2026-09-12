/**
 * 纹理回读（readTexturePixels）与「动态偏移 UBO」相关基础能力的单元测试。
 *
 * 回读在 Mock 后端是纯 CPU 路径，可以直接断言「区域/坐标/通道顺序」；
 * WebGPU/WebGL2 的真实回读由无头示例（examples/_verify-shared 等探针）覆盖。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockDevice } from "../device/createDevice.js";
import { TextureUsage } from "../gpu/types.js";
import { UniformBlock } from "../render/UniformBlock.js";
import { BufferUsage } from "../gpu/types.js";
import { Mat4 } from "../math/mat4.js";
/** 生成 32×16 的测试图：R=x*8、G=y*16、B=64、A=255（左上原点） */
function makeImage(width, height, bgra = false) {
    const out = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const r = x * 8;
            const g = y * 16;
            const b = 64;
            if (bgra) {
                out[i] = b;
                out[i + 1] = g;
                out[i + 2] = r;
            }
            else {
                out[i] = r;
                out[i + 1] = g;
                out[i + 2] = b;
            }
            out[i + 3] = 255;
        }
    }
    return out;
}
test("readTexturePixels：整图回读为紧凑 RGBA（左上原点）", async () => {
    const device = createMockDevice();
    const tex = device.createTexture({
        label: "src",
        width: 32,
        height: 16,
        format: "rgba8unorm",
        usage: TextureUsage.COPY_DST | TextureUsage.COPY_SRC,
    });
    tex.upload(makeImage(32, 16));
    const pixels = await device.readTexturePixels(tex);
    assert.equal(pixels.length, 32 * 16 * 4);
    const at = (x, y) => Array.from(pixels.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4));
    assert.deepEqual(at(0, 0), [0, 0, 64, 255]);
    assert.deepEqual(at(3, 2), [24, 32, 64, 255]);
    assert.deepEqual(at(31, 15), [248, 240, 64, 255]);
    device.destroy();
});
test("readTexturePixels：子区域以左上角为原点", async () => {
    const device = createMockDevice();
    const tex = device.createTexture({ width: 32, height: 16, format: "rgba8unorm", usage: TextureUsage.COPY_DST | TextureUsage.COPY_SRC });
    tex.upload(makeImage(32, 16));
    const sub = await device.readTexturePixels(tex, { x: 4, y: 5, width: 3, height: 2 });
    assert.equal(sub.length, 3 * 2 * 4);
    const at = (x, y) => Array.from(sub.subarray((y * 3 + x) * 4, (y * 3 + x) * 4 + 4));
    // 对应原图 (4,5) 与 (6,6)
    assert.deepEqual(at(0, 0), [32, 80, 64, 255]);
    assert.deepEqual(at(2, 1), [48, 96, 64, 255]);
    device.destroy();
});
test("readTexturePixels：bgra8unorm 纹理自动 swizzle 为 RGBA", async () => {
    const device = createMockDevice();
    const tex = device.createTexture({ width: 4, height: 2, format: "bgra8unorm", usage: TextureUsage.COPY_DST | TextureUsage.COPY_SRC });
    tex.upload(makeImage(4, 2, true));
    const pixels = await device.readTexturePixels(tex);
    // 原始存储为 BGRA：B=64、G=y*16、R=x*8；回读应为 RGBA
    assert.deepEqual(Array.from(pixels.subarray(0, 4)), [0, 0, 64, 255]);
    assert.deepEqual(Array.from(pixels.subarray(4, 8)), [8, 0, 64, 255]);
    assert.deepEqual(Array.from(pixels.subarray((1 * 4 + 0) * 4, (1 * 4 + 0) * 4 + 4)), [0, 16, 64, 255]);
    device.destroy();
});
/** 断言同步/异步调用抛出的错误信息匹配（本项目未引入 @types/node，assert.rejects 无类型定义） */
async function expectError(fn, pattern) {
    let caught = null;
    try {
        await fn();
    }
    catch (e) {
        caught = e;
    }
    assert.ok(caught instanceof Error, "应当抛出错误");
    const message = caught.message;
    assert.ok(pattern.test(message), `错误信息应匹配 ${pattern}，实际：${message}`);
}
test("readTexturePixels：越界与不支持的格式会报错", async () => {
    const device = createMockDevice();
    const rgba = device.createTexture({ width: 8, height: 8, format: "rgba8unorm", usage: TextureUsage.RENDER_ATTACHMENT });
    await expectError(() => device.readTexturePixels(rgba, { x: 4, y: 4, width: 8, height: 8 }), /越界/);
    const f32 = device.createTexture({ width: 8, height: 8, format: "rgba32float", usage: TextureUsage.RENDER_ATTACHMENT });
    await expectError(() => device.readTexturePixels(f32), /仅支持/);
    device.destroy();
});
test("submitCount：每次提交递增（动态偏移槽位复用的安全依据）", () => {
    const device = createMockDevice();
    const before = device.submitCount;
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [], depthStencilAttachment: null });
    pass.end();
    device.submit([encoder.finish()]);
    assert.equal(device.submitCount, before + 1);
    device.destroy();
});
test("UniformBlock：动态偏移环形槽按设备对齐要求分配，越界写成报错", async () => {
    const device = createMockDevice();
    const block = new UniformBlock(device, {
        label: "ring",
        fields: [{ name: "u_model", type: "mat4" }],
        slots: 4,
    });
    const alignment = device.limits.minUniformBufferOffsetAlignment ?? 256;
    assert.equal(block.slots, 4);
    assert.equal(block.stride % alignment, 0, `stride ${block.stride} 必须是 ${alignment} 的整数倍`);
    assert.ok(block.stride >= 64);
    assert.equal(block.buffer.size, block.stride * 4);
    assert.equal(block.buffer.usage & BufferUsage.UNIFORM, BufferUsage.UNIFORM);
    // 最后一个槽可写；越界槽位报错
    block.setMat4("u_model", Mat4.identity().translate(1, 2, 3));
    block.flushSlot(3);
    await expectError(() => block.flushSlot(4), /超出范围/);
    device.destroy();
});
//# sourceMappingURL=readback.test.js.map