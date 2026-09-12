/**
 * ColorPicker —— GPU 颜色拾取。
 *
 * 原理：把场景用「ID 材质」离屏渲染到一张 rgba8unorm 纹理（每个物体一种 ID 颜色），
 * 然后回读鼠标处的 1×1 像素，颜色即物体编号。
 *
 * 与射线拾取（Raycaster）相比：
 * - 颜色拾取是**逐像素精确**的（三角形级、含 alpha 裁剪/蒙版逻辑），天然支持任意几何；
 * - 但需要一次额外渲染 + 一次 GPU→CPU 回读（异步，几百微秒~几毫秒），不适合每帧每物体。
 *
 * 推荐用法：hover/click 时拾取（示例 examples/picking），或用 `render()` + 多次
 * `pickPixel()` 复用同一次 ID pass。
 */
import { InstancedMesh } from "../render/InstancedMesh.js";
import { SceneRenderer } from "../scene/SceneRenderer.js";
import { IdMaterial, decodeId } from "./IdMaterial.js";
import { TextureUsage } from "../gpu/types.js";
import { Vec3 } from "../math/vec3.js";
import { assert } from "../util/assert.js";
export class ColorPicker {
    device;
    sceneRenderer;
    _color = null;
    _depth = null;
    _material = null;
    _width = 0;
    _height = 0;
    _idToMesh = [];
    _dirty = true;
    _label;
    _eye = new Vec3();
    constructor(device, options = {}) {
        this.device = device;
        this.sceneRenderer = options.sceneRenderer ?? new SceneRenderer();
        this._label = options.label ?? "unidraw-picker";
        const size = device.presentSize();
        this.ensureTargets(options.width ?? size.width, options.height ?? size.height);
    }
    /** 当前 ID 目标尺寸。 */
    get size() {
        return { width: this._width, height: this._height };
    }
    /** 最近一次 ID pass 中「编号 → Mesh」的映射（索引即编号，0 为背景）。 */
    get idMap() {
        return this._idToMesh;
    }
    /** 是否需要重绘 ID pass（例如场景/相机变化后）。 */
    get dirty() {
        return this._dirty;
    }
    /** 标记 ID pass 失效（下一帧 pick 会重绘）。 */
    invalidate() {
        this._dirty = true;
    }
    /**
     * 渲染 ID pass：把场景中可见物体用 ID 材质画进离屏目标。
     * 返回参与拾取的物体数。
     */
    render(scene, camera, options = {}) {
        const mat = this._material;
        assert(mat, "ColorPicker 已销毁");
        const encoder = this.device.createCommandEncoder(`${this._label}-id`);
        const pass = encoder.beginRenderPass({
            label: `${this._label}-id`,
            colorAttachments: [
                { view: this._color.view(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } },
            ],
            depthStencilAttachment: {
                view: this._depth.view(),
                depthLoadOp: "clear",
                depthStoreOp: "store",
                depthClearValue: 1,
            },
        });
        const visible = this.sceneRenderer.collectVisible(scene, camera, {
            filter: options.filter,
            overrideMaterial: null,
        });
        const vp = camera.viewProjection;
        camera.getEyePosition(this._eye);
        mat.beginFrame(vp, this._eye);
        const map = this._idToMesh;
        map.length = 0;
        map.push(null); // 0 = 背景
        for (let i = 0; i < visible.length; i++) {
            const mesh = visible[i];
            const id = i + 1;
            map[id] = mesh;
            mat.setId(id);
            if (mesh instanceof InstancedMesh && mesh.instanceCount > 0 && mat.drawInstanced) {
                // 实例化网格整体一个 ID（拾取到 InstancedMesh 本身；逐实例 ID 需要 ID 顶点流，
                // 目前按「一个 InstancedMesh = 一个可选对象」处理）
                mesh.upload();
                mat.drawInstanced(pass, mesh.geometry, mesh.worldMatrix, mesh);
                continue;
            }
            mat.drawGeometry(pass, mesh.geometry, mesh.worldMatrix);
        }
        pass.end();
        this.device.submit([encoder.finish()]);
        this._dirty = false;
        return visible.length;
    }
    /**
     * 用当前场景与相机渲染 ID pass，然后读取指定 NDC 处的物体。
     *
     * 默认每次都会重绘（`options.refresh !== false`）：这是最不容易用错的语义 ——
     * ID 目标一旦过期（相机转动、物体移动/增删），复用它会拾取到错误的物体。
     * 同一帧内查询多个点时请用 `pickMany`（一次重绘 + 一次回读）。
     */
    async pick(scene, camera, ndc, options = {}) {
        if (options.refresh !== false)
            this.render(scene, camera, options);
        return this.pickPixel(ndc);
    }
    /**
     * 一次回读多个 NDC 点（一次重绘 + 一次 GPU→CPU 往返）。
     * 与 `pick` 相同：默认重绘 ID pass。
     */
    async pickMany(scene, camera, points, options = {}) {
        if (options.refresh !== false)
            this.render(scene, camera, options);
        if (points.length === 0)
            return [];
        // 计算所有点的像素包围盒，一次读回整块区域
        let minX = this._width;
        let minY = this._height;
        let maxX = 0;
        let maxY = 0;
        const pixels = points.map((p) => this.ndcToPixel(p));
        for (const p of pixels) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        }
        const width = maxX - minX + 1;
        const height = maxY - minY + 1;
        const data = await this.device.readTexturePixels(this._color, { x: minX, y: minY, width, height });
        return points.map((ndc, i) => {
            const p = pixels[i];
            const local = ((p.y - minY) * width + (p.x - minX)) * 4;
            return this.decode(ndc, p, {
                r: data[local],
                g: data[local + 1],
                b: data[local + 2],
                a: data[local + 3],
            });
        });
    }
    /**
     * 只回读像素，**要求最近一次 `render()` / `pick()` 的 ID pass 仍然有效**。
     *
     * 适合：先在静止场景上 `render()`，然后连续查询多个点（或配合 `invalidate()`
     * 手工管理失效）。场景/相机变化后必须 `render()` 或 `invalidate()`，否则会读到旧帧。
     */
    async pickPixel(ndc) {
        assert(this._color, "ColorPicker 已销毁");
        const pixel = this.ndcToPixel(ndc);
        const data = await this.device.readTexturePixels(this._color, { x: pixel.x, y: pixel.y, width: 1, height: 1 });
        return this.decode(ndc, pixel, { r: data[0], g: data[1], b: data[2], a: data[3] });
    }
    /**
     * 回读整个 ID 目标（调试用）：返回左上原点、紧凑 RGBA。
     * 配合 `idMap` 可以排查「ID pass 是否为空 / 编号是否对得上」这类问题。
     */
    async readTargetPixels() {
        assert(this._color, "ColorPicker 已销毁");
        return this.device.readTexturePixels(this._color);
    }
    /** NDC（-1..1，上为正）→ ID 目标像素（左上原点）。 */
    ndcToPixel(ndc) {
        const x = Math.min(this._width - 1, Math.max(0, Math.floor((ndc.x * 0.5 + 0.5) * this._width)));
        const y = Math.min(this._height - 1, Math.max(0, Math.floor((1 - (ndc.y * 0.5 + 0.5)) * this._height)));
        return { x, y };
    }
    /** 目标尺寸变化时重建离屏资源（画布 resize 后调用）。 */
    resize(width, height) {
        if (width === this._width && height === this._height)
            return;
        this.ensureTargets(width, height);
    }
    dispose() {
        this._color?.destroy();
        this._depth?.destroy();
        this._color = null;
        this._depth = null;
        this._idToMesh = [];
        this._dirty = true;
    }
    // ---- 内部 ---------------------------------------------------------------
    decode(ndc, pixel, color) {
        const id = decodeId(color.r, color.g, color.b);
        return { mesh: id > 0 ? (this._idToMesh[id] ?? null) : null, id, color, ndc, pixel };
    }
    ensureTargets(width, height) {
        const w = Math.max(1, Math.floor(width));
        const h = Math.max(1, Math.floor(height));
        if (this._color && this._depth && this._material && this._width === w && this._height === h)
            return;
        this._color?.destroy();
        this._depth?.destroy();
        this._width = w;
        this._height = h;
        this._color = this.device.createTexture({
            label: `${this._label}-color`,
            width: w,
            height: h,
            format: "rgba8unorm",
            usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.COPY_SRC,
        });
        this._depth = this.device.createTexture({
            label: `${this._label}-depth`,
            width: w,
            height: h,
            format: "depth24plus",
            usage: TextureUsage.RENDER_ATTACHMENT,
        });
        // ID 材质与尺寸无关（目标格式固定 rgba8unorm），只在首次创建；随 device 一起释放
        if (!this._material) {
            this._material = new IdMaterial(this.device, { label: this._label, targetFormat: "rgba8unorm" });
        }
        this._dirty = true;
    }
}
//# sourceMappingURL=ColorPicker.js.map