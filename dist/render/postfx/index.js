/**
 * 后处理模块：`RenderTarget`（见 `../RenderTarget.js`）+ `EffectComposer` + 内置效果。
 *
 * | 导出 | 作用 |
 * | --- | --- |
 * | `EffectComposer` | 效果链：场景目标（可选 MSAA）→ ping-pong 效果 → 输出 |
 * | `FullScreenPass` / `PostEffect` | 效果契约与全屏 pass 基类（自定义效果从这里开始） |
 * | `CopyPass` | 直通拷贝（也用于按输出格式呈现） |
 * | `ToneMapPass` | 色调映射（none/linear/reinhard/aces）+ 曝光 |
 * | `BloomPass` | 泛光（亮部 + 可分离模糊 + 叠加，自带半分辨率目标） |
 * | `VignettePass` / `GrayscalePass` | 暗角 / 灰度 |
 * | `ShaderPass` | 自定义单趟效果（GLSL + WGSL 成对给出） |
 *
 * 详见 docs/postfx.md。
 */
export * from "./FullScreenPass.js";
export * from "./EffectComposer.js";
export * from "./CopyPass.js";
export * from "./ToneMapPass.js";
export * from "./BloomPass.js";
export * from "./VignettePass.js";
export * from "./GrayscalePass.js";
export * from "./ShaderPass.js";
//# sourceMappingURL=index.js.map