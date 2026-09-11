/**
 * ShadowRenderer —— 阴影贴图渲染（方向光 + 聚光）。
 *
 * 每帧流程（**必须在主场景绘制之前调用**）：
 * 1. 用主相机做一次可见性收集，得到场景包围球（方向光自动拟合用）；
 *    包围球会按 `shadow.stabilize` **平滑 + 纹素对齐**，避免相机/物体微动时采样网格
 *    逐纹素跳动（这是阴影"闪"的主要原因）；
 * 2. 按 `collectLights()` 的顺序遍历可见灯，把 `castShadow` 的方向光/聚光
 *    依次分到贴图池里（最多 `MAX_SHADOW_MAPS` 张），计算光源视投影矩阵；
 * 3. 每个光源一趟「只写深度」的 pass（`colorAttachments: []`），
 *    用光源视锥剔除 + `ShadowDepthMaterial`（默认渲染背面，抗自阴影）绘制；
 * 4. 把光源矩阵/偏移参数打包进共享的 `ShadowBlock`。
 *
 * 参数换算（关键，早期版本在这里踩过坑）：
 * - `shadow.bias` 是**世界单位** → 打包前除以阴影相机的深度范围（`far - near`），
 *   变成与场景尺度无关的归一化深度偏移；
 * - `shadow.normalBias = 0`（默认）时按**纹素世界尺寸**自动取 `1.5 × 纹素`；
 * - `shadow.side` 决定渲染背面/正面/双面（薄片、单面平面需要 `"front"`/`"double"`）。
 *
 * ```ts
 * const shadows = new ShadowRenderer(device);
 * sun.castShadow = true;
 * shadows.renderAndSubmit(scene, camera, sceneRenderer, dt);   // 每帧
 * ```
 *
 * 用 `App` 时不需要手动调用：`AppOptions.shadows = true` 会自动完成。
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
import { shadowFilterCode, type ShadowSide } from "./ShadowSettings.js";

export interface ShadowRenderStats {
  /** 本帧渲染的阴影贴图数量 */
  maps: number;
  /** 本帧阴影 pass 里绘制的物体数（累计） */
  drawn: number;
  /** 因超出 `MAX_SHADOW_MAPS` 被跳过的投影灯数量 */
  skipped: number;
  /** 方向光拟合半径（平滑/对齐后的实际值） */
  fitRadius: number;
  /** 每个阴影纹素覆盖的世界尺寸（越小越清晰；调试/调参用） */
  texelWorld: number;
  /** 实际使用的归一化深度偏移（= bias 世界单位 / 深度范围；调试用） */
  biasDepth: number;
}

export interface ShadowRendererOptions {
  /** 默认贴图边长（像素，默认 1024；每盏灯可用 `light.shadow.mapSize` 覆盖） */
  mapSize?: number;
  /** 深度材质（缺省按需为每张贴图/每个 `side` 各建一个） */
  material?: ShadowDepthMaterial;
  label?: string;
  /**
   * 拟合平滑时间常数（秒，默认 0.3）：越大越稳但跟随越慢。
   * 只在 `shadow.stabilize !== false` 时生效。
   */
  stabilizeTau?: number;
}

export class ShadowRenderer {
  readonly device: Device;
  readonly resources: ShadowResources;
  readonly stats: ShadowRenderStats = { maps: 0, drawn: 0, skipped: 0, fitRadius: 0, texelWorld: 0, biasDepth: 0 };
  /** 是否启用（false 时 `render()` 直接返回，不产生任何 pass） */
  enabled = true;
  /** 每盏灯的默认贴图边长 */
  mapSize: number;
  /** 拟合平滑时间常数（秒） */
  stabilizeTau: number;

  private readonly _camera = new ShadowCamera();
  private readonly _lights: Light[] = [];
  private readonly _center = new Vec3();
  private readonly _targetCenter = new Vec3();
  private readonly _fitCenter = new Vec3();
  private readonly _worldPos = new Vec3();
  private _radius = 0;
  private _fitRadius = 0;
  private _hasFit = false;
  private readonly _label: string;
  /**
   * 深度材质缓存（key = `${贴图序号}:${side}`）。
   *
   * 为什么不共用一个：深度材质的**光源矩阵写在相机 UBO 里，而 UBO 是立即写入**的，
   * 若多张贴图共用材质，同一个 submit 内后一张的矩阵会覆盖前一张 —— 表现为
   * 「第一张阴影贴图里装的是最后一张的内容」（阴影完全错位/消失）。
   */
  private readonly _materials = new Map<string, ShadowDepthMaterial>();

  constructor(device: Device, options: ShadowRendererOptions = {}) {
    this.device = device;
    this._label = options.label ?? "shadow-depth";
    this.mapSize = Math.max(64, Math.floor(options.mapSize ?? 1024));
    this.stabilizeTau = Math.max(0.01, options.stabilizeTau ?? 0.3);
    this.resources = shadowResources(device);
    if (options.material) this._materials.set("0:back", options.material);
    this._materials.set("0:back", options.material ?? new ShadowDepthMaterial(device, { label: `${this._label}-0` }));
  }

  /** 第 0 张贴图用的深度材质（自定义剔除方式时可读取；`side` 用 `materialFor`） */
  get material(): ShadowDepthMaterial {
    return this.materialFor(0, "back");
  }

  /** 第 `index` 张贴图、指定面选项的深度材质 */
  materialFor(index: number, side: ShadowSide = "back"): ShadowDepthMaterial {
    const key = `${index}:${side}`;
    let material = this._materials.get(key);
    if (!material) {
      material = new ShadowDepthMaterial(this.device, {
        label: `${this._label}-${index}${side === "back" ? "" : `-${side}`}`,
        cullMode: side === "double" ? "none" : side === "front" ? "back" : "front",
      });
      this._materials.set(key, material);
    }
    return material;
  }

  /** 兼容旧名：第 `index` 张贴图的材质（默认 `side: "back"`） */
  materialAt(index: number): ShadowDepthMaterial {
    return this.materialFor(index, "back");
  }

  /**
   * 渲染所有投影灯的阴影贴图。
   *
   * @param encoder 目标命令编码器（阴影 pass 会排在后面记录的画布 pass 之前执行）
   * @param scene 场景根节点
   * @param camera 主相机（用于可见性收集；阴影 pass 内部用光源视锥剔除）
   * @param sceneRenderer 复用其 `collectVisible()`
   * @param dt 帧间隔（秒，用于平滑拟合；缺省 1/60）
   */
  render(
    encoder: CommandEncoder,
    scene: Node3D,
    camera: Camera,
    sceneRenderer: SceneRenderer,
    dt = 1 / 60,
  ): number {
    this.stats.maps = 0;
    this.stats.drawn = 0;
    this.stats.skipped = 0;
    if (!this.enabled) {
      this.resources.state.reset().finish();
      this.resources.flushBlock();
      return 0;
    }

    // 1) 收集可见灯（先于包围球：拟合需要知道方向光的贴图尺寸与 stabilize 开关）
    const lights = this._lights;
    collectLightNodes(scene, lights);
    let fitMapSize = this.mapSize;
    let fitStabilize = true;
    for (const light of lights) {
      if (light instanceof DirectionalLight && light.castShadow && light.shadow.enabled) {
        fitMapSize = Math.min(light.shadow.mapSize || this.mapSize, 4096);
        fitStabilize = light.shadow.stabilize;
        break;
      }
    }

    // 2) 场景包围球（方向光拟合用）：用主相机可见物体近似，并做稳定化处理
    this._collectBounds(scene, camera, sceneRenderer, dt, fitMapSize, fitStabilize);

    // 3) 分配贴图并计算光源矩阵
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

      let depthRange: number;
      let texelWorld: number;
      if (directional) {
        // areaSize > 0 时用固定半宽（最稳），否则用稳定化后的自动拟合半径
        const radius = settings.areaSize > 0 ? settings.areaSize : this._fitRadius;
        this._camera.fitDirectional(
          (light as DirectionalLight).direction,
          this._fitCenter,
          radius,
          map.size,
          settings.near,
          settings.far,
          settings.distance,
        );
        depthRange = this._camera.lastFar - this._camera.lastNear;
        texelWorld = (2 * radius) / map.size;
      } else {
        (light as SpotLight).getWorldPosition(this._worldPos);
        const distance = (light as SpotLight).distance;
        const far = settings.far > 0 ? settings.far : distance > 0 ? distance : 60;
        this._camera.fitSpot(this._worldPos, (light as SpotLight).direction, (light as SpotLight).angle, settings.near, far);
        depthRange = this._camera.lastFar - this._camera.lastNear;
        // 透视投影下纹素大小随距离变化：按中点距离估算（用于法线偏移）
        const mid = (this._camera.lastNear + this._camera.lastFar) * 0.5;
        texelWorld = (2 * mid * Math.tan(light.angle * 1.05)) / map.size;
      }
      map.matrix.copy(this._camera.matrix);
      map.nearPlane = this._camera.lastNear;
      map.farPlane = this._camera.lastFar;
      map.texelWorld = texelWorld;

      // 世界单位 → 归一化深度（WebGL2 的窗口深度只有一半范围，着色器里再乘 0.5）
      const biasDepth = settings.bias / Math.max(1e-4, depthRange);
      const normalBias = settings.normalBias > 0 ? settings.normalBias : texelWorld * 1.5;
      if (state.count === 0) {
        this.stats.texelWorld = texelWorld;
        this.stats.biasDepth = biasDepth;
      }
      state.add(map, directional ? SHADOW_KIND_DIRECTIONAL : SHADOW_KIND_SPOT, lightIndex, {
        bias: biasDepth,
        radius: settings.radius,
        normalBias,
        filter: shadowFilterCode(settings.filter),
        intensity: settings.intensity,
      });
      // 每个光源一个 side（材质不同）→ 记录在贴图上，绘制阶段取用
      map.viewSide = settings.side;
    }
    state.finish();

    // 3) 深度 pass（逐个光源，各自使用独立材质/相机 UBO）
    for (let i = 0; i < state.count; i++) {
      const map = state.maps[i]!;
      const material = this.materialFor(i, map.viewSide);
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
          material.drawInstanced(pass, mesh.geometry, mesh.worldMatrix, mesh);
          this.stats.drawn++;
          continue;
        }
        material.drawGeometry(pass, mesh.geometry, mesh.worldMatrix);
        this.stats.drawn++;
      }
      pass.end();
    }
    this.stats.maps = state.count;
    this.stats.fitRadius = this._fitRadius;

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
  renderAndSubmit(scene: Node3D, camera: Camera, sceneRenderer: SceneRenderer, dt = 1 / 60): number {
    const encoder = this.device.createCommandEncoder("shadows");
    const count = this.render(encoder, scene, camera, sceneRenderer, dt);
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

  /**
   * 清掉平滑拟合的状态：下一帧的包围球会**立刻**按当前可见物体重算（不做平滑）。
   *
   * 用途：相机瞬移、切换场景、自检里换测量目标 —— 这些情况下不需要平滑过渡。
   */
  resetFit(): void {
    this._hasFit = false;
  }

  /** 释放阴影资源（贴图池 + 深度材质）。设备销毁时可选调用。 */
  dispose(): void {
    this.resources.dispose();
    for (const material of this._materials.values()) material.dispose();
    this._materials.clear();
  }

  /**
   * 计算主相机可见物体构成的包围球（中心 + 半径），并做稳定化：
   *
   * 1. **平滑**：半径变大立刻跟随（不漏阴影）、变小按时间常数收敛；
   * 2. **量化半径**：把「纹素世界尺寸」量化到 1-2-5 阶梯（例如 0.02 / 0.05 / 0.1），
   *    于是纹素大小（= 采样网格密度）在绝大部分时间保持不变 —— 否则半径每帧微调，
   *    阴影贴图的采样网格就每帧漂移，表现为「影子一直闪」；
   * 3. **量化中心**：把拟合中心对齐到 1/16 半径的网格（配合 `fitDirectional` 里的
   *    光源位置纹素对齐，采样网格在轻推相机时纹丝不动）。
   */
  private _collectBounds(
    scene: Node3D,
    camera: Camera,
    sceneRenderer: SceneRenderer,
    dt: number,
    mapSize: number,
    stabilize: boolean,
  ): void {
    const visible = sceneRenderer.collectVisible(scene, camera);
    const target = this._targetCenter;
    target.set(0, 0, 0);
    if (visible.length === 0) {
      target.set(0, 0, 0);
      this._applyFit(target, 1, dt, mapSize, stabilize);
      return;
    }
    for (let i = 0; i < visible.length; i++) {
      const mesh = visible[i]!;
      target.set(target.x + mesh.worldCenter.x, target.y + mesh.worldCenter.y, target.z + mesh.worldCenter.z);
    }
    target.multiplyScalar(1 / visible.length);
    let radius = 0;
    for (let i = 0; i < visible.length; i++) {
      const mesh = visible[i]!;
      const dx = mesh.worldCenter.x - target.x;
      const dy = mesh.worldCenter.y - target.y;
      const dz = mesh.worldCenter.z - target.z;
      radius = Math.max(radius, Math.hypot(dx, dy, dz) + mesh.worldRadius);
    }
    this._applyFit(target, Math.max(1e-2, radius), dt, mapSize, stabilize);
  }

  /** 把目标包围球转成「稳定」的拟合参数（平滑 + 纹素尺寸量化 + 中心量化） */
  private _applyFit(
    target: Readonly<Vec3>,
    radius: number,
    dt: number,
    mapSize: number,
    stabilize: boolean,
  ): void {
    if (!this._hasFit) {
      this._hasFit = true;
      this._radius = radius;
      this._center.copy(target);
    } else if (radius >= this._radius) {
      // 变大立刻跟随（不漏阴影）
      this._radius = radius;
      this._center.copy(target);
    } else {
      // 变小：按时间常数平滑（**平滑状态单独保存**，量化结果不写回平滑状态，
      // 否则平滑值会被量化值反复顶回阶梯上沿，永远收敛不下来）
      const k = 1 - Math.exp(-dt / this.stabilizeTau);
      this._radius += (radius - this._radius) * k;
      this._center.set(
        this._center.x + (target.x - this._center.x) * k,
        this._center.y + (target.y - this._center.y) * k,
        this._center.z + (target.z - this._center.z) * k,
      );
    }

    if (!stabilize) {
      this._fitRadius = this._radius;
      this._fitCenter.copy(this._center);
      return;
    }
    // 量化半径：纹素世界尺寸落在 1-2-5 阶梯（2*radius/mapSize），
    // 于是纹素大小（采样网格密度）在绝大部分时间保持不变 —— 否则半径每帧微调，
    // 阴影贴图采样网格每帧漂移，表现为「影子一直闪」。
    const size = Math.max(1, mapSize);
    const texel = (2 * this._radius) / size;
    const exp = Math.floor(Math.log10(Math.max(texel, 1e-6)));
    const pow10 = Math.pow(10, exp);
    const mant = texel / pow10;
    const nice = mant < 1.5 ? 1 : mant < 3.5 ? 2 : mant < 7.5 ? 5 : 10;
    this._fitRadius = (nice * pow10 * size) / 2;
    // 中心量化到 1/16 半径的网格（配合 `fitDirectional` 里的光源位置纹素对齐）
    const grid = Math.max(0.01, this._fitRadius / 16);
    this._fitCenter.set(
      Math.round(this._center.x / grid) * grid,
      Math.round(this._center.y / grid) * grid,
      Math.round(this._center.z / grid) * grid,
    );
  }

  /** 当前方向光阴影拟合中心的只读快照（调试/自检用） */
  get boundsCenter(): Readonly<Vec3> {
    return this._fitCenter;
  }

  /** 当前方向光阴影拟合半径（量化后的实际值；调试/自检用） */
  get boundsRadius(): number {
    return this._fitRadius;
  }

  /** 最近一次收集到的灯节点数量（含不投影的；调试/自检用） */
  get lightCount(): number {
    return this._lights.length;
  }
}
