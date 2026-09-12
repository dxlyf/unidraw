import { test } from "node:test";
import assert from "node:assert/strict";
import { std140Layout, arrayElementOffset } from "../gpu/std140.js";
import { vertexFormatInfo, textureFormatInfo, INDEX_FORMAT_BYTES } from "../gpu/formats.js";
function layout(fields) {
    return std140Layout(fields);
}
test("std140: scalar & vector offsets", () => {
    const l = layout([
        { name: "a", type: "f32" },
        { name: "b", type: "f32" },
    ]);
    assert.equal(l.fields[0].offset, 0);
    assert.equal(l.fields[1].offset, 4);
    assert.equal(l.size, 8);
});
test("std140: vec3 aligned to 16", () => {
    const l = layout([{ name: "v", type: "vec3" }]);
    assert.equal(l.fields[0].align, 16);
    assert.equal(l.size, 16); // 块按最大对齐取整
    const l2 = layout([
        { name: "v", type: "vec3" },
        { name: "f", type: "f32" },
    ]);
    // vec3 起始对齐 16，但只占用 12 字节 → 后续标量紧跟 12
    assert.equal(l2.fields[1].offset, 12);
    assert.equal(l2.size, 16);
    const l3 = layout([
        { name: "v", type: "vec3" },
        { name: "v4", type: "vec4" },
    ]);
    // vec4 需要 16 对齐 → 从 16 开始
    assert.equal(l3.fields[1].offset, 16);
    assert.equal(l3.size, 32);
});
test("std140: vec4 + f32", () => {
    const l = layout([
        { name: "v", type: "vec4" },
        { name: "f", type: "f32" },
    ]);
    assert.equal(l.fields[0].offset, 0);
    assert.equal(l.fields[1].offset, 16);
    assert.equal(l.size, 32);
});
test("std140: mat4", () => {
    const l = layout([{ name: "m", type: "mat4" }]);
    assert.equal(l.size, 64);
    const l2 = layout([
        { name: "m", type: "mat4" },
        { name: "v3", type: "vec3" },
    ]);
    assert.equal(l2.fields[1].offset, 64);
    assert.equal(l2.size, 80);
});
test("std140: float array stride 16", () => {
    const l = layout([{ name: "arr", type: "f32", count: 3 }]);
    const f = l.fields[0];
    assert.equal(f.stride, 16);
    assert.equal(arrayElementOffset(f, 0), 0);
    assert.equal(arrayElementOffset(f, 1), 16);
    assert.equal(arrayElementOffset(f, 2), 32);
    assert.equal(l.size, 48);
});
test("std140: vec4 array", () => {
    const l = layout([{ name: "arr", type: "vec4", count: 2 }]);
    const f = l.fields[0];
    assert.equal(f.stride, 16);
    assert.equal(arrayElementOffset(f, 1), 16);
    assert.equal(l.size, 32);
});
test("vertex format sizes", () => {
    assert.equal(vertexFormatInfo("float32x3").size, 12);
    assert.equal(vertexFormatInfo("float32").components, 1);
    assert.equal(vertexFormatInfo("unorm8x4").size, 4);
    assert.equal(vertexFormatInfo("uint16x2").size, 4);
    assert.equal(vertexFormatInfo("float32x3").wgslFormat, "float32x3");
});
test("texture format bytes", () => {
    assert.equal(textureFormatInfo("rgba8unorm").bytesPerTexel, 4);
    assert.equal(textureFormatInfo("rgba8unorm-srgb").bytesPerTexel, 4);
    assert.equal(textureFormatInfo("depth24plus").depth, true);
    assert.equal(textureFormatInfo("r8unorm").bytesPerTexel, 1);
});
test("index format bytes", () => {
    assert.equal(INDEX_FORMAT_BYTES.uint16, 2);
    assert.equal(INDEX_FORMAT_BYTES.uint32, 4);
});
//# sourceMappingURL=std140-formats.test.js.map