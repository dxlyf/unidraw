import { Color } from "../../math/color.js";
import { rgbaTexture } from "./rgba.js";
/** 棋盘格纹理（用于纹理示例）。 */
export function createCheckerTexture(device, options = {}) {
    const cell = Math.max(1, options.cell ?? 16);
    const width = options.width ?? cell * 8;
    const height = options.height ?? cell * 8;
    const ca = options.colorA ?? new Color(0.15, 0.16, 0.2, 1);
    const cb = options.colorB ?? new Color(0.85, 0.87, 0.95, 1);
    const texture = rgbaTexture(device, width, height, options.label, options.format ?? "rgba8unorm");
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const dark = ((Math.floor(x / cell) + Math.floor(y / cell)) & 1) === 0;
            const c = dark ? ca : cb;
            const i = (y * width + x) * 4;
            rgba[i] = Math.round(c.r * 255);
            rgba[i + 1] = Math.round(c.g * 255);
            rgba[i + 2] = Math.round(c.b * 255);
            rgba[i + 3] = Math.round(c.a * 255);
        }
    }
    texture.upload(rgba);
    return texture;
}
//# sourceMappingURL=checker.js.map