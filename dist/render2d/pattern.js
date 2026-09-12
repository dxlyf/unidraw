/**
 * `createPattern` 的返回值：把一张图像当作**图案**使用（`fillStyle` / `strokeStyle`）。
 *
 * 与渐变的区别在于采样方式：图案的 uv 由**用户空间坐标**除以图案尺寸得到，
 * 重复方式（repeat / repeat-x / repeat-y / no-repeat）由采样器的寻址模式表达，
 * 因此可以一次性平铺满整个形状（不需要在 CPU 侧铺瓦片）。
 */
export class CanvasPattern {
    kind = "pattern";
    /** 图案源（用于文字：字形的图集直接按图案填充栅格化） */
    source;
    repetition;
    texture;
    sampler;
    width;
    height;
    constructor(source, repetition, texture, sampler, width, height) {
        this.source = source;
        this.repetition = repetition;
        this.texture = texture;
        this.sampler = sampler;
        this.width = width;
        this.height = height;
    }
}
//# sourceMappingURL=pattern.js.map