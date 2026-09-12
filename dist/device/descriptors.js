export const ColorWriteMask = {
    RED: 1 << 0,
    GREEN: 1 << 1,
    BLUE: 1 << 2,
    ALPHA: 1 << 3,
    ALL: 0xf,
};
/**
 * BindGroupLayout 的“内容指纹”：内容相同的布局可以安全共用，
 * 从而在 WebGL2 后端只分配一次 UBO binding point / 纹理单元
 * （避免大量同构材质把有限的 binding 资源耗尽）。
 */
export function bindGroupLayoutCacheKey(desc) {
    const entries = desc.entries
        .map((e) => `${e.binding}:${e.type}:${e.visibility}:${e.name ?? ""}:${e.hasDynamicOffset ? "dyn" : ""}:${e.sampleType ?? ""}`)
        .sort()
        .join("|");
    return `[${entries}]`;
}
// ---------------------------------------------------------------------------
// 便捷的默认值
// ---------------------------------------------------------------------------
export function defaultPrimitiveState() {
    return { topology: "triangle-list", cullMode: "none", frontFace: "ccw" };
}
export function defaultSamplerDescriptor() {
    return {
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
        addressModeW: "clamp-to-edge",
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "linear",
        maxAnisotropy: 1,
        mips: false,
    };
}
//# sourceMappingURL=descriptors.js.map