/**
 * 拾取相关的回归测试（针对用户反馈的两个缺陷）：
 *
 * 1. `ColorPicker.pick()` 必须**每次重绘 ID pass** ——
 *    此前只在首次（`dirty`）时重绘，相机一转就复用过期目标，
 *    表现为「选中/高亮到错误物体，且射线看起来更准」；
 * 2. `HighlightPlugin` 的材质接管必须精确恢复，且选中与悬停可同时高亮 ——
 *    此前用单个 `_restore` 槽，移开鼠标会清掉选中项的高亮 / 恢复错对象。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockDevice } from "../device/createDevice.js";
import { Scene } from "../scene/Scene.js";
import { Mesh } from "../render/Mesh.js";
import { Geometry } from "../render/Geometry.js";
import { box } from "../render/primitives.js";
import { ColorMaterial, UnlitColorMaterial } from "../render/material.js";
import { Camera } from "../render/Camera.js";
import { Color } from "../math/color.js";
import { ColorPicker } from "../picking/ColorPicker.js";
import { HighlightPlugin } from "../app/plugins/HighlightPlugin.js";
import { App } from "../app/App.js";
function setup() {
    const device = createMockDevice();
    const scene = new Scene();
    const camera = new Camera();
    camera.setPerspective(Math.PI / 3, 1, 0.1, 100);
    camera.distance = 6;
    camera.update();
    const meshes = [];
    for (let i = 0; i < 3; i++) {
        const mesh = new Mesh(Geometry.create(device, box(1, 1, 1)));
        mesh.model.setIdentity().translate(i * 2 - 2, 0, 0);
        mesh.material = new ColorMaterial(device, new Color().setHex("#4c8dff"));
        scene.add(mesh);
        meshes.push(mesh);
    }
    return { device, scene, camera, meshes };
}
test("环形 UBO 扩容：旧块也必须纳入提交前上传（否则早期物体模型矩阵丢失）", async () => {
    const device = createMockDevice();
    const { IdMaterial } = await import("../picking/IdMaterial.js");
    const { Mat4 } = await import("../math/mat4.js");
    const material = new IdMaterial(device, { label: "ring-growth", modelRingSlots: 2, depth: false });
    const geometry = Geometry.create(device, box(1, 1, 1));
    const camera = new Camera();
    camera.distance = 8;
    camera.update();
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: null, loadOp: "clear", storeOp: "store" }],
        depthStencilAttachment: null,
    });
    material.beginFrame(camera.viewProjection, camera.getEyePosition());
    // 画 6 个物体 → 触发 2→4→8 两次扩容
    for (let i = 0; i < 6; i++) {
        material.setId(i + 1);
        material.drawGeometry(pass, geometry, Mat4.identity().translate(i * 2, 0, 0));
    }
    pass.end();
    device.submit([encoder.finish()]);
    const blocks = material.flushBlocks;
    assert.ok(blocks.length >= 6, `应有初始 4 块 + 扩容新增的模型/ID 块，实际 ${blocks.length}`);
    for (const block of blocks) {
        assert.equal(block.hasPending, false, `块 ${block.label ?? ""} 在 submit 后仍有待上传数据 —— 说明扩容后的旧块被漏刷`);
    }
    // 扩容出来的模型块必须真的写入了数据（非全 0）
    const grown = blocks.filter((b) => /-ring\d+$/.test(b.label ?? ""));
    assert.ok(grown.length >= 2, `应有扩容产生的模型块，实际 ${grown.length}（${blocks.map((b) => b.label).join(", ")}）`);
    for (const block of grown) {
        const data = block.buffer.data;
        let nonZero = 0;
        for (const byte of data)
            if (byte !== 0)
                nonZero++;
        assert.ok(nonZero > 0, `扩容块 ${block.label} 应包含模型矩阵数据`);
    }
    material.dispose();
    device.destroy();
});
test("延迟上传：逐 draw 写入的 UBO 必须在 submit 前落到 GPU（batching 后仍生效）", async () => {
    const { device, scene, camera, meshes } = setup();
    const picker = new ColorPicker(device, { label: "flush-test" });
    picker.resize(64, 32);
    // ID pass：每个物体一次 draw，ID 只写进 CPU 暂存 → 提交时必须 flush 到 buffer
    device.clearDrawCalls();
    picker.render(scene, camera);
    device.submit([device.createCommandEncoder().finish()]);
    const idMaterial = picker._material;
    const idBuffer = idMaterial._idBlock.buffer.data;
    const idFloats = new Float32Array(idBuffer.buffer, idBuffer.byteOffset, idBuffer.byteLength / 4);
    let nonZero = 0;
    for (const b of idBuffer)
        if (b !== 0)
            nonZero++;
    assert.ok(nonZero > 0, "ID 块必须在提交前被上传（否则颜色拾取全部 miss）");
    // 第 1 号物体（slot 0）的 u_id = encodeId(1)/255 → (1/255, 0, 0, 1)
    assert.ok(Math.abs(idFloats[0] - 1 / 255) < 1e-6, `slot0 的 u_id.r 应为 1/255，实际 ${idFloats[0]}`);
    assert.equal(idFloats[3], 1, "slot0 的 u_id.a 应为 1");
    // 模型矩阵块也必须上传（否则所有物体都塌到原点）
    const modelBlock = picker._material.modelBlock;
    const modelBytes = modelBlock.buffer.data;
    let modelNonZero = 0;
    for (const b of modelBytes)
        if (b !== 0)
            modelNonZero++;
    assert.ok(modelNonZero > 0, "模型矩阵块必须上传");
    // 依赖关系：把 ID 写入清掉（不 submit）时不应残留旧数据影响判断
    void meshes;
    picker.dispose();
    device.destroy();
});
test("ColorPicker：pick() 每次都重绘 ID pass（不接受过期目标），pickPixel() 复用", async () => {
    const { device, scene, camera } = setup();
    const picker = new ColorPicker(device, { label: "stale-test" });
    picker.resize(64, 32);
    // 首次 render：绘制次数 = 可见物体数
    device.clearDrawCalls();
    const drawn = picker.render(scene, camera);
    assert.equal(drawn, 3);
    assert.equal(device.drawCalls.length, 3);
    assert.equal(picker.dirty, false, "render 之后 dirty 应为 false");
    // 关键回归：即使 dirty === false，pick() 也必须重新渲染（相机已改变）
    device.clearDrawCalls();
    await picker.pick(scene, camera, { x: 0, y: 0 });
    assert.equal(device.drawCalls.length, 3, "pick() 必须重绘 ID pass，否则会读到过期目标");
    // pickPixel() 是「复用当前目标」的低层接口：不重绘
    device.clearDrawCalls();
    await picker.pickPixel({ x: 0.5, y: 0.5 });
    assert.equal(device.drawCalls.length, 0, "pickPixel() 不应重绘");
    // 显式 refresh: false 时才允许复用（省一次 pass 的场景）
    device.clearDrawCalls();
    await picker.pickMany(scene, camera, [{ x: 0, y: 0 }], { refresh: false });
    assert.equal(device.drawCalls.length, 0, "refresh:false 复用当前目标");
    // pickMany 默认重绘，且一次回读多点
    device.clearDrawCalls();
    await picker.pickMany(scene, camera, [
        { x: -0.5, y: 0 },
        { x: 0, y: 0 },
        { x: 0.5, y: 0 },
    ]);
    assert.equal(device.drawCalls.length, 3, "pickMany 默认重绘一次");
    picker.dispose();
    device.destroy();
});
test("HighlightPlugin：选中 ∪ 悬停同时高亮，材质精确恢复", async () => {
    const { device, meshes } = setup();
    const canvas = {
        width: 128,
        height: 128,
        clientWidth: 128,
        clientHeight: 128,
        style: {},
        addEventListener() { },
        removeEventListener() { },
        setPointerCapture() { },
        releasePointerCapture() { },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 128, height: 128 }),
    };
    const app = App.fromDevice(device, canvas, { depth: false, input: false, autoResize: false });
    app.scene.add(...meshes);
    const highlightMat = new UnlitColorMaterial(device, new Color().setHex("#ffe066"), { depth: false, targetFormat: "rgba8unorm" });
    const original = meshes.map((m) => m.material);
    // 注入可控的拾取来源（Mock 不做光栅化，颜色拾取无像素可读）
    let nextHit = null;
    const stubPicker = {
        async pick() {
            return {
                mesh: nextHit,
                id: nextHit ? meshes.indexOf(nextHit) + 1 : 0,
                color: { r: 0, g: 0, b: 0, a: 0 },
                ndc: { x: 0, y: 0 },
                pixel: { x: 0, y: 0 },
            };
        },
    };
    const hovered = [];
    const selected = [];
    const plugin = new HighlightPlugin({
        highlight: highlightMat,
        picker: stubPicker,
        onHover: (m) => hovered.push(m),
        onSelect: (m) => selected.push(m),
    });
    await app.useAsync(plugin);
    // 悬停第 0 个对象
    nextHit = meshes[0];
    await plugin.hoverAt({ x: 0, y: 0 });
    assert.equal(plugin.hovered, meshes[0]);
    assert.equal(meshes[0].material, highlightMat, "悬停对象应换成高亮材质");
    assert.equal(plugin.highlightedCount, 1);
    // 选中第 1 个对象（悬停仍在第 0 个）→ 两个都高亮
    nextHit = meshes[1];
    await plugin.selectAt({ x: 0, y: 0 });
    assert.equal(plugin.selected, meshes[1]);
    assert.equal(meshes[1].material, highlightMat, "选中对象应高亮");
    assert.equal(meshes[0].material, highlightMat, "悬停对象应保持高亮（两者可同时高亮）");
    assert.equal(plugin.highlightedCount, 2);
    // 悬停移到第 2 个对象
    nextHit = meshes[2];
    await plugin.hoverAt({ x: 0, y: 0 });
    assert.equal(meshes[2].material, highlightMat);
    assert.equal(meshes[0].material, original[0], "离开悬停的对象应恢复原材质");
    assert.equal(meshes[1].material, highlightMat, "选中对象仍高亮");
    assert.equal(plugin.highlightedCount, 2);
    // 清空选中 → 只剩悬停高亮
    plugin.clearSelection();
    assert.equal(meshes[1].material, original[1], "取消选中后恢复原材质");
    assert.equal(meshes[2].material, highlightMat);
    assert.equal(plugin.highlightedCount, 1);
    // dispose → 全部恢复
    plugin.dispose();
    for (let i = 0; i < meshes.length; i++) {
        assert.equal(meshes[i].material, original[i], `对象 ${i} 的材质应被完整恢复`);
    }
    assert.equal(plugin.highlightedCount, 0);
    assert.equal(hovered.length, 2);
    assert.equal(selected.length, 1);
    app.dispose();
});
//# sourceMappingURL=picking-regression.test.js.map