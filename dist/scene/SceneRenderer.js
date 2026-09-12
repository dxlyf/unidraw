/**
 * SceneRenderer —— 场景渲染器（性能优先）：
 * - 一次自顶向下更新世界矩阵（脏标记，静止子树不重算）；
 * - 视锥剔除（世界包围球，broad phase）；
 * - 排序：renderOrder → 不透明近到远（利于 early-z）→ 半透明远到近；
 * - 复用内部数组/对象，避免逐帧 GC；
 * - 输出 stats（objects/drawn/culled/triangles），便于接入性能面板。
 */
import { Mesh } from "../render/Mesh.js";
import { InstancedMesh } from "../render/InstancedMesh.js";
import { Mat4 } from "../math/mat4.js";
import { Frustum } from "./Frustum.js";
import { Vec3 } from "../math/vec3.js";
import { collectLights } from "../render/lights/collectLights.js";
import { LightsState } from "../render/lights/LightsState.js";
export class SceneRenderer {
    frustumCulling = true;
    sort = true;
    stats = { objects: 0, drawn: 0, culled: 0, triangles: 0, nodes: 0 };
    frustum = new Frustum();
    _items = [];
    _sorted = [];
    _visible = [];
    _usedMaterials = [];
    _eye = new Vec3();
    /** 本帧灯光打包缓冲（复用） */
    lights = new LightsState();
    /** 退化实例绘制的临时矩阵（复用） */
    _instanceMatrix = new Mat4();
    /**
     * 收集「可见（已剔除、已排序）」的 Mesh。
     *
     * 供自定义 pass 复用同一套 世界矩阵更新 / 视锥剔除 / 排序 结果，
     * 例如 GPU 颜色拾取（每个物体换一个 ID 材质绘制）与阴影贴图。
     * 返回的数组是内部复用缓冲，下一次调用即失效。
     */
    collectVisible(scene, camera, options = {}) {
        const stats = this.stats;
        stats.objects = 0;
        stats.drawn = 0;
        stats.culled = 0;
        stats.triangles = 0;
        stats.nodes = 0;
        // 1) 世界矩阵（脏标记 + 版本传播）
        scene.updateWorldMatrix(true);
        // 2) 视锥
        const useFrustum = options.frustumCulling ?? this.frustumCulling;
        if (useFrustum)
            this.frustum.setFromProjectionMatrix(options.viewProjection ?? camera.viewProjection);
        camera.getEyePosition(this._eye);
        // 3) 收集
        let count = 0;
        const items = this._items;
        const collect = (node) => {
            stats.nodes++;
            if (!(node instanceof Mesh))
                return;
            stats.objects++;
            node.updateWorldBounds();
            const material = options.overrideMaterial ?? node.material;
            if (!material)
                return;
            if (options.filter && !options.filter(node))
                return;
            if (useFrustum && node.frustumCulled) {
                if (!this.frustum.intersectsSphere(node.worldCenter, node.worldRadius)) {
                    stats.culled++;
                    return;
                }
            }
            let item = items[count];
            if (!item) {
                item = { mesh: node, material, dist: 0, transparent: 0, order: 0 };
                items[count] = item;
            }
            item.mesh = node;
            item.material = material;
            item.order = node.renderOrder;
            item.transparent = material.isTransparent ? 1 : 0;
            const dx = node.worldCenter.x - this._eye.x;
            const dy = node.worldCenter.y - this._eye.y;
            const dz = node.worldCenter.z - this._eye.z;
            item.dist = dx * dx + dy * dy + dz * dz;
            count++;
        };
        scene.traverseVisible(collect);
        // 4) 排序（复用数组，避免逐帧分配）
        const list = this._sorted;
        list.length = count;
        for (let i = 0; i < count; i++)
            list[i] = items[i];
        if (options.sort ?? this.sort) {
            list.sort((a, b) => {
                if (a.order !== b.order)
                    return a.order - b.order;
                if (a.transparent !== b.transparent)
                    return a.transparent - b.transparent;
                return a.transparent ? b.dist - a.dist : a.dist - b.dist;
            });
        }
        const visible = this._visible;
        visible.length = count;
        for (let i = 0; i < count; i++)
            visible[i] = list[i].mesh;
        return visible;
    }
    render(pass, scene, camera, options = {}) {
        const list = this._sorted;
        this.collectVisible(scene, camera, options);
        // 收集场景灯光（没有灯时使用与历史版本等价的默认光）并喂给材质
        const lights = this.collectLightsForRender(scene, options.lights);
        // 关键：绘制前把相机与灯光喂给本次用到的每个材质（u_viewProj / LightsBlock）。
        // 漏掉这一步的表现是「draw 都调用了、stats 也对，但画面全空」——
        // 因为材质的 viewProj 是零矩阵，顶点全部投影到原点。
        const used = this._usedMaterials;
        used.length = 0;
        for (let i = 0; i < list.length; i++) {
            const material = list[i].material;
            if (used.indexOf(material) >= 0)
                continue;
            used.push(material);
            material.beginFrame?.(camera.viewProjection, this._eye, lights);
        }
        const stats = this.stats;
        for (let i = 0; i < list.length; i++) {
            const it = list[i];
            const mesh = it.mesh;
            const instances = mesh instanceof InstancedMesh && mesh.instanceCount > 0 ? mesh : null;
            if (instances) {
                instances.upload();
                if (it.material.drawInstanced) {
                    it.material.drawInstanced(pass, mesh.geometry, mesh.worldMatrix, instances);
                    stats.drawn++;
                }
                else {
                    // 材质不支持实例化：退化成 N 次普通绘制（保证画面正确）
                    for (let k = 0; k < instances.instanceCount; k++) {
                        instances.getMatrixAt(k, this._instanceMatrix);
                        Mat4.multiply(mesh.worldMatrix, this._instanceMatrix, this._instanceMatrix);
                        it.material.drawGeometry(pass, mesh.geometry, this._instanceMatrix);
                        stats.drawn++;
                    }
                }
            }
            else {
                it.material.drawGeometry(pass, mesh.geometry, mesh.worldMatrix);
                stats.drawn++;
            }
            const g = mesh.geometry;
            stats.triangles += g.indexCount > 0 ? (g.indexCount / 3) * (instances ? instances.instanceCount : 1) : Math.floor(g.vertexCount / 3) * (instances ? instances.instanceCount : 1);
        }
    }
    /**
     * 收集灯光（`collectLights()` 的包装）：结果复用内部 `LightsState`，
     * 供自定义 pass 也拿到同一份灯光数据。
     */
    collectLightsForRender(scene, lights) {
        if (lights) {
            this.lights.fillFrom(lights);
            return this.lights;
        }
        const result = collectLights(scene, this.lights);
        this.lightCount = result.count;
        this.usedDefaultLights = result.usedDefault;
        return this.lights;
    }
    /** 本帧收集到的灯光数量（不含默认光）；供 HUD/自检使用 */
    lightCount = 0;
    /** 本帧是否使用了默认光（场景里没有灯） */
    usedDefaultLights = false;
}
//# sourceMappingURL=SceneRenderer.js.map