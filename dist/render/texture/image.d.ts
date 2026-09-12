import type { Device } from "../../device/Device.js";
import { Texture } from "../../device/resources.js";
export type CanvasImageSourceLike = CanvasImageSource & {
    readonly width?: number;
    readonly height?: number;
    readonly naturalWidth?: number;
    readonly naturalHeight?: number;
    readonly videoWidth?: number;
    readonly videoHeight?: number;
};
export declare function sourceSize(source: CanvasImageSourceLike): {
    width: number;
    height: number;
};
/**
 * 从任意 CanvasImageSource（HTMLImageElement / ImageBitmap / HTMLCanvasElement / ImageData…）
 * 采样为纹理。需要浏览器 DOM；跨域图像可能被画布污染。
 */
export declare function textureFromImageSource(device: Device, source: CanvasImageSourceLike, options?: {
    label?: string;
    format?: "rgba8unorm" | "rgba8unorm-srgb";
}): Texture;
/** 通过 <img> 加载 URL 图像并创建纹理。 */
export declare function textureFromUrl(device: Device, url: string, options?: {
    label?: string;
    format?: "rgba8unorm" | "rgba8unorm-srgb";
    crossOrigin?: string;
}): Promise<Texture>;
export { Texture };
//# sourceMappingURL=image.d.ts.map