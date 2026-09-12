/**
 * 阴影系统的常量与格式约定。
 *
 * `MAX_SHADOW_MAPS` 决定了一次着色里能同时生效的阴影贴图数量，也决定了
 * `ShadowBlock` 的布局大小与 `defaultGroupEntries()` 里声明的
 * 纹理/采样器 binding 数量（7..10 纹理 + 11..14 采样器）。
 *
 * 上限越高，WebGL2 每个 draw 的纹理单元占用越多（16 个上限下建议 <= 4）。
 */
export const MAX_SHADOW_MAPS = 4;
/** 阴影贴图边长上限（像素） */
export const MAX_SHADOW_MAP_SIZE = 4096;
//# sourceMappingURL=constants.js.map