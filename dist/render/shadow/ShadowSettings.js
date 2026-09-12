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
export function normalizeShadowFilter(value, fallback = "pcf3") {
    return value === "hard" || value === "pcf3" || value === "pcf5" ? value : fallback;
}
/** 滤波方式的着色器编码（打包进 `u_shadowParams2.z`） */
export function shadowFilterCode(filter) {
    return filter === "hard" ? 0 : filter === "pcf5" ? 2 : 1;
}
export class ShadowSettings {
    enabled;
    mapSize;
    bias;
    normalBias;
    radius;
    filter;
    intensity;
    side;
    near;
    far;
    areaSize;
    distance;
    stabilize;
    constructor(options = {}) {
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
    cullModeForSide() {
        if (this.side === "double")
            return "none";
        // 渲染背面 = 剔除正面；渲染正面 = 剔除背面
        return this.side === "back" ? "front" : "back";
    }
}
function clampInt(value, min, max) {
    return Math.max(min, Math.min(max, Math.round(value)));
}
//# sourceMappingURL=ShadowSettings.js.map