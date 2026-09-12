/**
 * 光照代码片段（GLSL ES 3.00 与 WGSL 各一份），由内置材质拼接进 fragment shader。
 *
 * 统一入口：`unidrawLighting(n, worldPos, viewDir, ambientWeight) -> vec4(diffuse rgb, specular)`
 * - 环境光：`u_ambient × ambientWeight`（材质可用它调节“接收多少环境光”）；
 * - 方向光：`ndl = max(dot(n, -dir), 0)`，无衰减；
 * - 点光：`L = lightPos - worldPos`，`atten = 1/max(d,ε)^decay`；
 *   `range > 0` 时再乘平滑截断 `(clamp(1 - (d/range)^4, 0, 1))²`；
 * - 聚光：点光基础上乘 `smoothstep(cosInner, cosOuter, dot(-L, dir))`；
 * - 高光：Blinn-Phong，`h = normalize(L + viewDir)`，指数取 `u_params.x`（shininess）；
 *   调用方乘 `u_params.y`（强度）。
 *
 * UBO 布局见 `lights/LightsState.ts`；绑定固定为 `@group(0) @binding(3)`。
 */
export interface LightingShaderOptions {
    /** 是否生成高光代码（PhongMaterial 需要） */
    specular?: boolean;
    /**
     * 是否生成阴影代码（默认 true）。
     *
     * 内置受光材质都打开；自定义材质如果不想支付「阴影查询」的代价（几行 uniform
     * 读取 + 最多 4 次矩阵乘），可以传 false（但 layout 里的 binding 仍然存在）。
     */
    shadows?: boolean;
}
/** GLSL：LightsBlock 声明 + `unidrawLighting()` */
export declare function lightingGLSL(options?: LightingShaderOptions): string;
/** WGSL：与 GLSL 版本逐项对应的 `unidrawLighting()` */
export declare function lightingWGSL(options?: LightingShaderOptions): string;
//# sourceMappingURL=lightingShader.d.ts.map