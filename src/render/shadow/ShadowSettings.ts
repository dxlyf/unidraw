/**
 * ShadowSettings —— 一盏灯的阴影参数。
 *
 * ```ts
 * const sun = new DirectionalLight(new Vec3(-0.4, -1, -0.3), "#fff3d6", 1.1);
 * sun.castShadow = true;          // 打开阴影
 * sun.shadow.mapSize = 2048;      // 贴图分辨率（默认 1024）
 * sun.shadow.bias = 0.002;        // 深度偏移（消除自阴影摩尔纹）
 * scene.add(sun);
 * ```
 *
 * 一次着色最多支持 `MAX_SHADOW_MAPS` 张贴图（见 shadow/ShadowState.ts），
 * 超出部分按「先方向光、后聚光」的顺序排队等待下一帧。
 */

export interface ShadowOptions {
  /** 是否投射阴影（默认 true；`light.castShadow` 也必须是 true） */
  enabled?: boolean;
  /** 阴影贴图边长（像素，默认 1024；自动 clamp 到 [64, 4096]） */
  mapSize?: number;
  /** 深度偏移：越小越容易自阴影（acne），越大越容易出现「影子脱离物体」（peter-panning） */
  bias?: number;
  /** 沿法线方向的偏移（世界单位，缓解斜面自阴影；默认 0.03） */
  normalBias?: number;
  /** PCF 采样半径（纹素，默认 1.5；0 = 硬阴影，只取 1 个样本） */
  radius?: number;
  /** 阴影相机的近平面（聚光/方向光自动拟合时的微调） */
  near?: number;
  /** 阴影相机远平面（聚光默认取灯的 distance；0 = 自动） */
  far?: number;
  /**
   * 方向光的正交阴影半宽（世界单位）。
   *
   * 0（默认）= 按主相机可见物体自动拟合；手动指定可以稳定阴影质量与范围
   * （自动拟合会随可见物体变化，可能出现轻微抖动）。
   */
  areaSize?: number;
  /** 方向光阴影相机到场景中心的距离倍数（默认 1.5，仅自动拟合时生效） */
  distance?: number;
}

export class ShadowSettings {
  enabled: boolean;
  mapSize: number;
  bias: number;
  normalBias: number;
  radius: number;
  near: number;
  far: number;
  areaSize: number;
  distance: number;

  constructor(options: ShadowOptions = {}) {
    this.enabled = options.enabled !== false;
    this.mapSize = clampInt(options.mapSize ?? 1024, 64, 4096);
    this.bias = options.bias ?? 0.0018;
    this.normalBias = options.normalBias ?? 0.03;
    this.radius = Math.max(0, options.radius ?? 1.5);
    this.near = options.near ?? 0;
    this.far = options.far ?? 0;
    this.areaSize = Math.max(0, options.areaSize ?? 0);
    this.distance = Math.max(1, options.distance ?? 1.5);
  }
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
