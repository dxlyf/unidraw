/**
 * 纹理回读（readback）公共工具：三后端统一的坐标/格式约定。
 *
 * 约定：
 * - 坐标系为**左上原点**（与 WebGPU 一致，WebGL2 后端内部翻转）；
 * - 输出紧凑排列；每纹素字节数由 `type` 决定：
 *   - `"uint8"`（默认）：8bit RGBA，`width*height*4` 字节，支持
 *     `rgba8unorm / rgba8unorm-srgb / bgra8unorm / bgra8unorm-srgb`（后两者内部 swizzle）；
 *   - `"float32"`：每通道 32 位浮点，`width*height*16` 字节，支持 `rgba32float`
 *     以及深度纹理（`depth32float` / `depth24plus`，单通道值铺在 R 上，GBA 为 0/1）。
 */
import { assert } from "../util/assert.js";
const READABLE_UINT8 = new Set(["rgba8unorm", "rgba8unorm-srgb", "bgra8unorm", "bgra8unorm-srgb"]);
const READABLE_FLOAT = new Set(["rgba32float", "depth32float", "depth24plus"]);
const DEPTH = new Set(["depth32float", "depth24plus"]);
export function assertReadableFormat(format, type = "uint8") {
    const ok = type === "float32" ? READABLE_FLOAT.has(format) : READABLE_UINT8.has(format);
    assert(ok, type === "float32"
        ? `type:"float32" 的回读仅支持 rgba32float / depth32float / depth24plus，当前为 ${format}`
        : `readTexturePixels（默认 uint8）仅支持 rgba8unorm / rgba8unorm-srgb / bgra8unorm / bgra8unorm-srgb，当前为 ${format}`);
}
/** 归一化读回区域（含边界与格式校验）。 */
export function resolveReadRect(texture, options = {}) {
    const type = options.type ?? "uint8";
    assertReadableFormat(texture.format, type);
    const x = Math.max(0, Math.floor(options.x ?? 0));
    const y = Math.max(0, Math.floor(options.y ?? 0));
    const width = Math.max(1, Math.floor(options.width ?? texture.width - x));
    const height = Math.max(1, Math.floor(options.height ?? texture.height - y));
    assert(x + width <= texture.width && y + height <= texture.height, "readTexturePixels 区域越界");
    const bgra = texture.format === "bgra8unorm" || texture.format === "bgra8unorm-srgb";
    const depth = DEPTH.has(texture.format);
    const float = type === "float32";
    const bytesPerTexel = float ? (depth ? 4 : 16) : 4;
    const layer = Math.max(0, Math.floor(options.layer ?? 0));
    assert(layer < texture.depthOrArrayLayers, `readTexturePixels 层号越界：${layer} >= ${texture.depthOrArrayLayers}`);
    return { x, y, width, height, layer, bgra, bytesPerTexel, float, depth };
}
/** 上下翻转（WebGL2 的 readPixels 自下而上）。 */
export function flipRowsInPlace(data, width, height, bytesPerTexel = 4) {
    const rowBytes = width * bytesPerTexel;
    const tmp = new Uint8Array(rowBytes);
    for (let top = 0, bottom = height - 1; top < bottom; top++, bottom--) {
        const a = top * rowBytes;
        const b = bottom * rowBytes;
        tmp.set(data.subarray(a, a + rowBytes));
        data.copyWithin(a, b, b + rowBytes);
        data.set(tmp, b);
    }
}
/** BGRA → RGBA 原地交换。 */
export function swizzleBgraToRgbaInPlace(data) {
    for (let i = 0; i < data.length; i += 4) {
        const b = data[i];
        data[i] = data[i + 2];
        data[i + 2] = b;
    }
}
/** 深度值（单通道浮点）铺成 RGBA 浮点：R = 深度，GBA = 0/0/1。 */
export function expandDepthToRgbaFloat(depth, out) {
    for (let i = 0, j = 0; i < depth.length; i++, j += 4) {
        out[j] = depth[i];
        out[j + 1] = 0;
        out[j + 2] = 0;
        out[j + 3] = 1;
    }
}
/** 从带行间距的原始数据中拷贝出紧凑数据（WebGPU copyTextureToBuffer 的行对齐）。 */
export function repackRows(src, bytesPerRow, width, height, out, bytesPerTexel = 4) {
    const tight = width * bytesPerTexel;
    for (let row = 0; row < height; row++) {
        const from = row * bytesPerRow;
        out.set(src.subarray(from, from + tight), row * tight);
    }
}
//# sourceMappingURL=readback.js.map