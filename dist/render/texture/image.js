import { Texture } from "../../device/resources.js";
import { assert } from "../../util/assert.js";
import { rgbaTexture } from "./rgba.js";
export function sourceSize(source) {
    const w = source.naturalWidth ?? source.videoWidth ?? source.width;
    const h = source.naturalHeight ?? source.videoHeight ?? source.height;
    assert(w && h && w > 0 && h > 0, "图像源尺寸不可用（跨域图像可能污染画布）");
    return { width: w, height: h };
}
/**
 * 从任意 CanvasImageSource（HTMLImageElement / ImageBitmap / HTMLCanvasElement / ImageData…）
 * 采样为纹理。需要浏览器 DOM；跨域图像可能被画布污染。
 */
export function textureFromImageSource(device, source, options = {}) {
    assert(typeof document !== "undefined", "textureFromImageSource 需要浏览器环境");
    const { width, height } = sourceSize(source);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    assert(ctx, "无法创建 2d 画布");
    ctx.drawImage(source, 0, 0);
    const image = ctx.getImageData(0, 0, width, height);
    const texture = rgbaTexture(device, width, height, options.label, options.format ?? "rgba8unorm");
    texture.upload(image.data);
    return texture;
}
/** 通过 <img> 加载 URL 图像并创建纹理。 */
export async function textureFromUrl(device, url, options = {}) {
    assert(typeof document !== "undefined", "textureFromUrl 需要浏览器环境");
    const img = new Image();
    if (options.crossOrigin)
        img.crossOrigin = options.crossOrigin;
    img.src = url;
    await img.decode();
    return textureFromImageSource(device, img, options);
}
export { Texture };
//# sourceMappingURL=image.js.map