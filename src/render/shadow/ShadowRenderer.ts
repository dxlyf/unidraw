/**
 * ShadowRenderer —— 阴影贴图渲染（方向光 + 聚光）。
 *
 * 每帧流程（**必须在主场景绘制之前调用**）：
 * 1. 用主相机做一次可见性收集，得到场景包围球（方向光自动拟合用）；
 * 2. 按 `collectLights()` 的顺序遍历可见灯，把 `castShadow` 的方向光/聚光
 *    依次分到贴图池里（最多 `MAX_SHADOW_MAPS` 张），计算光源视投影矩阵；
 * 3. 每个光源一趟「只写深度」的 pass（`colorAttachments: []`），
 *    用光源视锥剔除 + `ShadowDepthMaterial`（正面剔除）绘制；
 * 4. 把光源矩阵/偏移参数打包进共享的 `ShadowBlock`（着色器里按「类型 + 序号」匹配）。
 *
 * ```ts
 * const shadows = new ShadowRenderer(device);
 * sun.castShadow = true;
 *
 * // 每帧（同一 encoder，阴影 pass 必须在画布 pass 之前）
 * shadows.render(encoder, scene, camera, sceneRenderer);
 * const pass = encoder.beginRenderPass({ … canvas … });
 * sceneRenderer.render(pass, scene, camera);
 * ```
 *
 * 用 `App` 时不需要手动调用：`AppOptions.shadows = true` 会让 App 在每帧
 * 主绘制之前自动渲染阴影。
 */

import type { Device } from "../../device/Device.js";
import type { CommandEncoder } from "../../command/encoder.js";
import type { Camera } from "../Camera.js";
import type { SceneRenderer } from "../../scene/SceneRenderer.js";
import type { Node3D } from "../../scene/Node3D.js";
import type { Light } from "../lights/Light.js";
import { DirectionalLight } from "../lights/DirectionalLight.js";
import { SpotLight } from "../lights/SpotLight.js";
import { collectLightNodes } from "../lights/collectLightNodes.js";
import { Vec3 } from "../../math/vec3.js";
import { InstancedMesh } from "../InstancedMesh.js";
import { ShadowCamera } from "./ShadowCamera.js";
import { ShadowDepthMaterial } from "./ShadowDepthMaterial.js";
import { shadowResources, type ShadowResources } from "./ShadowResources.js";
import { MAX_SHADOW_MAPS } from "./constants.js";
import { SHADOW_KIND_DIRECTIONAL, SHADOW_KIND_SPOT } from "./ShadowState.js";

export interface ShadowRenderStats {
  /** 本帧渲染的阴影贴图数量 */
  maps: number;
  /** 本帧阴影 pass 里绘制的物体数（累计） */
  drawn: number;
  /** 因超出 `MAX_SHADOW_MAPS` 被跳过的投影灯数量 */
  skipped: number;
}

export interface ShadowRendererOptions {
  /** 默认贴图边长（像素，默认 1024；每盏灯可用 `light.shadow.mapSize` 覆盖） */
  mapSize?: number;
  /** 深度材质（缺省按需为每张贴图各建一个；可传入共享实例——仅当每帧只渲染一张贴图时安全） */
  material?: ShadowDepthMaterial;
  label?: string;
}

export class ShadowRenderer {
  readonly device: Device;
  readonly resources: ShadowResources;
  readonly stats: ShadowRenderStats = { maps: 0, drawn: 0, skipped: 0 };
  /** 是否启用（false 时 `render()` 直接返回，不产生任何 pass） */
  enabled = true;
  /** 每盏灯的默认贴图边长 */
  mapSize: number;

  private readonly _camera = new ShadowCamera();
  private readonly _lights: Light[] = [];
  private readonly _center = new Vec3();
  private readonly _worldPos = new Vec3();
  private _radius = 0;
  private _label: string;
  /**
   * 每张贴图一个深度材质。
   *
   * 为什么不共用一个：深度材质的**光源矩阵写在相机 UBO 里，而 UBO 是立即写入**的，
   * 若多张贴图共用材质，同一个 submit 内后一张的矩阵会覆盖前一张 —— 表现为
   * 「第一张阴影贴图里装的是最后一张的内容」（阴影完全错位/消失）。
   */
  private readonly _materials: ShadowDepthMaterial[] = [];
  private readonly _sharedMaterial: ShadowDepthMaterial | null;

  constructor(device: Device, options: ShadowRendererOptions = {}) {
    this.device = device;
    this._label = options.label ?? "shadow-depth";
    this.mapSize = Math.max(64, Math.floor(options.mapSize ?? 1024));
    this.resources = shadowResources(device);
    this._sharedMaterial = options.material ?? null;
    if (this._sharedMaterial) this._materials.push(this._sharedMaterial);
  }

  /** 第 0 张贴图用的深度材质（自定义投影方式/剔除方式时可读取） */
  get material(): ShadowDepthMaterial {
    return this._materialAt(0);
  }

  /** 第 `index` 张贴图用的深度材质（按需创建） */
  materialAt(index: number): ShadowDepthMaterial {
    return this._materialAt(index);
  }

  /**
   * 渲染所有投影灯的阴影贴图。
   *
   * @param encoder 目标命令编码器（阴影 pass 会排在后面记录的画布 pass 之前执行）
   * @param scene 场景根节点
   * @param camera 主相机（用于可见性收集；阴影 pass 内部用光源视锥剔除）
   * @param sceneRenderer 复用其 `collectVisible()`
   */
  render(encoder: CommandEncoder, scene: Node3D, camera: Camera, sceneRenderer: SceneRenderer): number {
    this.stats.maps = 0;
    this.stats.drawn = 0;
    this.stats.skipped = 0;
    if (!this.enabled) {
      this.resources.state.reset().finish();
      this.resources.flushBlock();
      return 0;
    }

    // 1) 场景包围球（方向光拟合用）：用主相机可见物体近似
    this._collectBounds(scene, camera, sceneRenderer);

    // 2) 分配贴图并计算光源矩阵
    const lights = this._lights;
    collectLightNodes(scene, lights);
    const state = this.resources.state.reset();
    let dirIndex = 0;
    let spotIndex = 0;

    for (let i = 0; i < lights.length; i++) {
      const light = lights[i]!;
      const directional = light instanceof DirectionalLight;
      const spot = light instanceof SpotLight;
      if (!directional && !spot) continue;
      if (!light.castShadow || !light.shadow.enabled) continue;

      const lightIndex = directional ? dirIndex++ : spotIndex++;
      if (state.count >= MAX_SHADOW_MAPS) {
        this.stats.skipped++;
        continue;
      }
      const settings = light.shadow;
      const map = this.resources.acquire(state.count, Math.min(settings.mapSize || this.mapSize, 4096));

      if (directional) {
        this._camera.fitDirectional(
          (light as DirectionalLight).direction,
          this._center,
          this._radius,
          map.size,
          settings.near,
          settings.far,
          settings.distance,
        );
      } else {
        (light as SpotLight).getWorldPosition(this._worldPos);
        const distance = (light as SpotLight).distance;
        const far = settings.far > 0 ? settings.far : distance > 0 ? distance : 60;
        this._camera.fitSpot(this._worldPos, (light as SpotLight).direction, (light as SpotLight).angle, settings.near, far);
      }
      map.matrix.copy(this._camera.matrix);
      state.add(map, directional ? SHADOW_KIND_DIRECTIONAL : SHADOW_KIND_SPOT, lightIndex, {
        bias: settings.bias,
        radius: settings.radius,
        normalBias: settings.normalBias,
      });
    }
    state.finish();

    // 3) 深度 pass（逐个光源，各自使用**独立**的深度材质/相机 UBO）
    for (let i = 0; i < state.count; i++) {
      const map = state.maps[i]!;
      const material = this._materialAt(i);
      material.setLightMatrix(map.matrix);
      const pass = encoder.beginRenderPass({
        label: `${map.label}-pass`,
        colorAttachments: [],
        depthStencilAttachment: map.depthAttachment(),
      });
      // 光源视锥剔除（材质由我们手动喂矩阵，所以直接画，不走 SceneRenderer.render）
      const visible = sceneRenderer.collectVisible(scene, camera, {
        viewProjection: map.matrix,
        sort: false,
      });
      material.beginFrame();
      for (let m = 0; m < visible.length; m++) {
        const mesh = visible[m]!;
        if (mesh instanceof InstancedMesh && mesh.instanceCount > 0) {
          // InstancedMesh：一次深度绘制画全部实例（深度材质用的是标准顶点着色器，
          // 会自动换成实例化版本）
          mesh.upload();
          if (material.drawInstanced) {
            material.drawInstanced(pass, mesh.geometry, mesh.worldMatrix, mesh);
            this.stats.drawn++;
            continue;
          }
        }
        material.drawGeometry(pass, mesh.geometry, mesh.worldMatrix);
        this.stats.drawn++;
      }
      pass.end();
    }
    this.stats.maps = state.count;

    // 4) 打包（共享 UBO，一次写）
    this.resources.flushBlock();
    return state.count;
  }

  /**
   * 便捷版本：自己创建 encoder 并提交。
   *
   * **推荐用法**：WebGPU 不允许「同一 submit 内既写又读同一张纹理」，
   * 所以阴影 pass 必须与「采样阴影贴图的主 pass」分两次提交；
   * 本方法自动满足这个约束。用 `App` 时不需要手动调用（`AppOptions.shadows`）。
   */
  renderAndSubmit(scene: Node3D, camera: Camera, sceneRenderer: SceneRenderer): number {
    const encoder = this.device.createCommandEncoder("shadows");
    const count = this.render(encoder, scene, camera, sceneRenderer);
    this.device.submit([encoder.finish()]);
    return count;
  }

  /**
   * 把阴影数据清空（本帧无阴影）。
   *
   * 用于「对比开/关阴影」这类调试：清空后着色器立即退回完全受光，
   * 不需要改动任何材质或灯光状态。
   */
  clear(): void {
    this.stats.maps = 0;
    this.stats.drawn = 0;
    this.stats.skipped = 0;
    this.resources.state.reset().finish();
    this.resources.flushBlock();
  }

  /** 释放阴影资源（贴图池 + 深度材质）。设备销毁时可选调用。 */
  dispose(): void {
    this.resources.dispose();
    for (const material of this._materials) material.dispose();
    this._materials.length = 0;
  }

  /** 取第 `index` 张贴图的深度材质（按需创建；`options.material` 只用于第 0 张） */
  private _materialAt(index: number): ShadowDepthMaterial {
    let material = this._materials[index];
    if (!material) {
      material = new ShadowDepthMaterial(this.device, { label: `${this._label}-${index}` });
      this._materials[index] = material;
    }
    return material;
  }

  /** 计算主相机可见物体构成的包围球（中心 + 半径） */
  private _collectBounds(scene: Node3D, camera: Camera, sceneRenderer: SceneRenderer): void {
    const visible = sceneRenderer.collectVisible(scene, camera);
    const center = this._center;
    center.set(0, 0, 0);
    let count = 0;
    for (let i = 0; i < visible.length; i++) {
      const mesh = visible[i]!;
      center.set(center.x + mesh.worldCenter.x, center.y + mesh.worldCenter.y, center.z + mesh.worldCenter.z);
      count++;
    }
    if (count === 0) {
      center.set(0, 0, 0);
      this._radius = 1;
      return;
    }
    center.set(center.x / count, center.y / count, center.z / count);
    let radius = 0;
    for (let i = 0; i < visible.length; i++) {
      const mesh = visible[i]!;
      const dx = mesh.worldCenter.x - center.x;
      const dy = mesh.worldCenter.y - center.y;
      const dz = mesh.worldCenter.z - center.z;
      radius = Math.max(radius, Math.hypot(dx, dy, dz) + mesh.worldRadius);
    }
    this._radius = Math.max(1e-2, radius);
  }

  /** 当前方向光阴影拟合中心的只读快照（调试/自检用） */
  get boundsCenter(): Readonly<Vec3> {
    return this._center;
  }

  /** 当前方向光阴影拟合半径（调试/自检用） */
  get boundsRadius(): number {
    return this._radius;
  }

  /** 最近一次收集到的灯节点数量（含不投影的；调试/自检用） */
  get lightCount(): number {
    return this._lights.length;
  }
}
