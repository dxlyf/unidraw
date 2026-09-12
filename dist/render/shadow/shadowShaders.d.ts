/**
 * 阴影相关的着色器片段。
 *
 * 1. **深度 pass**：只需要顶点阶段，fragment 为空（WebGPU 允许「无颜色附件 + 空 fragment」）；
 * 2. **采样片段**：`ShadowBlock` 声明 + 手动 PCF。
 *
 * 深度比较**不用比较采样器**，而是 `texelFetch` / `textureLoad` 读深度值自己比 ——
 * 两个后端语义完全一致，也不依赖任何扩展。
 *
 * 每张贴图打包 4 个参数（见 `ShadowState`）：
 * ```
 * u_shadowParams[m]  = (bias, 1/mapSize, 类型, 光源序号)     bias 已换算成归一化深度
 * u_shadowParams2[m] = (PCF 半径(纹素), 法线偏移(世界), 滤波方式, 阴影强度)
 * ```
 * 其中滤波方式 0=硬边 / 1=3x3 / 2=5x5，强度 0..1 会按 `mix(1, visibility, intensity)` 生效。
 */
/** 深度 pass 的顶点着色器与内置材质共用（同一个顶点格式与 uniform 布局） */
export declare const SHADOW_DEPTH_FRAGMENT_GLSL = "#version 300 es\nprecision highp float;\n// \u53EA\u5199\u6DF1\u5EA6\uFF1A\u4E0D\u9700\u8981\u4EFB\u4F55\u8F93\u51FA\uFF08GLSL ES 3.00 \u5141\u8BB8\u96F6\u8F93\u51FA\u7684\u7247\u5143\u7740\u8272\u5668\uFF09\nvoid main() {}\n";
/** 深度 pass 的 WGSL 片元阶段（无输入无输出） */
export declare const SHADOW_DEPTH_FRAGMENT_WGSL = "\n@fragment\nfn fs_main() {}\n";
/** GLSL：`ShadowBlock` + 阴影采样（硬边 / 3x3 / 5x5 PCF） */
export declare function shadowLookupGLSL(): string;
/** WGSL：与 GLSL 版本逐项对应的阴影采样（注意 v 轴翻转） */
export declare function shadowLookupWGSL(): string;
/** 阴影采样器 binding 名称（WebGL2 按「第 i 个纹理配第 i 个采样器」配对） */
export declare function shadowSamplerName(index: number): string;
/** 阴影贴图纹理 binding 名称 */
export declare function shadowTextureName(index: number): string;
//# sourceMappingURL=shadowShaders.d.ts.map