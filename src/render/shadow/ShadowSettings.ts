/**
 * ShadowSettings —— 一盏灯的阴影参数。
 *
 * ```ts
 * const sun = new DirectionalLight(new Vec3(-0.4, -1, -0.3), "#fff3d6", 1.1);
 * sun.castShadow = true;          // 打开阴影
 * sun.shadow.mapSize = 2048;      // 贴图分辨率（默认 1024）
 * sun.shadow.bias = 0.04;         // 深度偏移（**世界单位**，默认 0.04）
 * sun.shadow.normalBias = 0;      // 0 = 按纹素大小自动（推荐）
 * scene.add(sun);
 * ```
 *
 * 抗自阴影（acne）的三个旋钮，从便宜到贵：
 * 1. `bias`：沿光线方向的深度偏移（**世界单位**，内部按阴影相机深度范围换算成归一化深度）；
 * 2. `normalBias`：沿表面法线的世界单位偏移（0 = 自动 = 1.5 纹素），对斜面/薄片最有效；
 * 3. `mapSize` / `filter`：分辨率与滤波（提高分辨率等价于减小纹素、减少锯齿与 acne）。
 *
 * > `bias` 的单位是**世界单位**（不是归一化深度）：这样同一组参数在大小不同的场景里
 * > 表现一致 —— 早期版本用归一化深度，场景越大有效偏移越小，叠在一起的薄物体就会闪。
 *
 * 一次着色最多支持 `MAX_SHADOW_MAPS` 张贴图（见 shadow/ShadowState.ts）。
 */

/** 阴影滤波方式：硬边（1 次比较）/ 3x3 / 5x5 PCF */
export type ShadowFilter = "hard" | "pcf3" | "pcf5";

/** 渲染进阴影贴图的面：背面（默认，抗自阴影）/ 正面（单面几何）/ 双面 */
export type ShadowSide = "back" | "front" | "double";

export interface ShadowOptions {
  /** 是否投射阴影（默认 true；`light.castShadow` 也必须是 true） */
  enabled?: boolean;
  /** 阴影贴图边长（像素，默认 1024；自动 clamp 到 [64, 4096]） */
  mapSize?: number;
  /**
   * 深度偏移（**世界单位**，默认 0.04）。
   *
   * 太小 → 自阴影条纹（acne，叠在一起的薄物体最明显）；太大 → 影子脱离物体（peter-panning）。
   * 经验值：约 0.5~1.5 个阴影纹素（纹素大小 = 2×拟合半径 / mapSize）。
   */
  bias?: number;
  /**
   * 沿法线的世界单位偏移（默认 **0 = 自动**，按 1.5 个纹素计算）。
   *
   * 对斜面与薄片（平面、薄盒子）最有效；设为 0 会退回「纯深度偏移」。
   */
  normalBias?: number;
  /** PCF 采样半径（纹素，默认 2；0 等价于硬阴影） */
  radius?: number;
  /** 滤波方式（默认 `"pcf3"`） */
  filter?: ShadowFilter;
  /** 阴影强度 0..1（0 = 看不出阴影，1 = 全黑，默认 1） */
  intensity?: number;
  /** 渲染进阴影贴图的面（默认 `"back"`：渲染背面，抗自阴影） */
  side?: ShadowSide;
  /** 阴影相机的近平面（0 = 自动；方向光按包围球自动拟合，聚光用 0.1） */
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
  /**
   * 是否**平滑**自动拟合的包围球（默认 true）。
   *
   * 打开后：半径增大立刻跟随（不会漏阴影），缩小按时间平滑收敛，并把拟合中心对齐到
   * 纹素网格 —— 这样相机/物体轻微移动时阴影采样网格不会逐纹素跳动（消除"闪烁"）。
   */
  stabilize?: boolean;
}

export function normalizeShadowFilter(value: string | undefined, fallback: ShadowFilter = "pcf3"): ShadowFilter {
  return value === "hard" || value === "pcf3" || value === "pcf5" ? value : fallback;
}

/** 滤波方式的着色器编码（打包进 `u_shadowParams2.z`） */
export function shadowFilterCode(filter: ShadowFilter): number {
  return filter === "hard" ? 0 : filter === "pcf5" ? 2 : 1;
}

export class ShadowSettings {
  enabled: boolean;
  mapSize: number;
  bias: number;
  normalBias: number;
  radius: number;
  filter: ShadowFilter;
  intensity: number;
  side: ShadowSide;
  near: number;
  far: number;
  areaSize: number;
  distance: number;
  stabilize: boolean;

  constructor(options: ShadowOptions = {}) {
    this.enabled = options.enabled !== false;
    this.mapSize = clampInt(options.mapSize ?? 1024, 64, 4096);
    this.bias = options.bias ?? 0.04;
    // 0 = 自动（由 ShadowRenderer 按纹素大小计算）
    this.normalBias = Math.max(0, options.normalBias ?? 0);
    this.radius = Math.max(0, options.radius ?? 2);
    this.filter = normalizeShadowFilter(options.filter);
    this.intensity = Math.max(0, Math.min(1, options.intensity ?? 1));
    this.side = options.side === "front" || options.side === "double" ? options.side : "back";
    this.near = options.near ?? 0;
    this.far = options.far ?? 0;
    this.areaSize = Math.max(0, options.areaSize ?? 0);
    this.distance = Math.max(1, options.distance ?? 1.5);
    this.stabilize = options.stabilize !== false;
  }

  /** 该面选项对应的剔除模式（阴影 pass 用反向剔除） */
  cullModeForSide(): "front" | "back" | "none" {
    if (this.side === "double") return "none";
    // 渲染背面 = 剔除正面；渲染正面 = 剔除背面
    return this.side === "back" ? "front" : "back";
  }
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
