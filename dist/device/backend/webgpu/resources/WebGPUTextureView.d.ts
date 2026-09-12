import { TextureView } from "../../../resources.js";
export declare class WebGPUTextureView extends TextureView {
    /**
     * 惰性创建 GPU 视图。
     *
     * - **默认视图**（`layerCount === null`）：维度要跟着纹理走 —— cube 纹理必须用
     *   `dimension: "cube"` 才能当立方体贴图采样，2D 数组要用 `"2d-array"` 才能一次
     *   采到所有层（WebGPU 默认视图是「单层 2d」）。
     * - **单层视图**（`viewLayer()`，`layerCount === 1`）：必须是 `dimension: "2d"` +
     *   `baseArrayLayer`，这样才能把某一层面当作渲染附件（cube 的一个面 = 一层）。
     */
    gpuView(): GPUTextureView;
}
//# sourceMappingURL=WebGPUTextureView.d.ts.map