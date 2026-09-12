/**
 * 资源缓存键：`createProgram` / `createRenderPipeline` 的**内容指纹**。
 *
 * 为什么需要：材质是最容易重复创建资源的对象 —— 同一份着色器 + 同样的
 * 管线状态（格式/剔除/深度/混合/采样数）会被不同材质实例反复申请。
 * 用内容指纹做一层设备级缓存后：
 * - 相同管线只创建一次（GL 程序/BindGroupLayout/PipelineLayout 都省下来）；
 * - WebGL2 的 `useProgram` 去重命中率更高（不同材质交替绘制不再来回切程序）；
 * - 大量同构材质（例如示例里的 25 个球各一个材质）启动开销显著下降。
 *
 * 指纹只包含**影响原生资源内容**的字段；label / 注释之类不参与。
 */
/** 32 位 FNV-1a：把长源码折成短 key（Map 里比较短字符串更快） */
export function hashString(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}
/** 程序指纹：GLSL 顶点/片元 + WGSL 模块（含入口名） */
export function programCacheKey(desc) {
    const glsl = desc.glsl ? `${hashString(desc.glsl.vertex)}.${hashString(desc.glsl.fragment)}` : "-";
    const wgsl = desc.wgsl
        ? `${hashString(desc.wgsl.code)}.${desc.wgsl.vertexEntryPoint ?? "vs_main"}.${desc.wgsl.fragmentEntryPoint ?? "fs_main"}`
        : "-";
    return `${glsl}|${wgsl}`;
}
/**
 * 管线指纹：程序 id + 顶点布局 + 光栅状态 + 深度状态 + 颜色目标 + 采样数。
 *
 * `programId` 由设备侧按 Program 对象分配（同一份程序源码共享同一个 Program，
 * 因此这里用 id 就等价于用源码指纹，但更便宜）。
 */
export function pipelineCacheKey(desc, programId) {
    const buffers = desc.vertex.buffers
        .map((b) => {
        if (!b)
            return "_";
        const attrs = b.attributes.map((a) => `${a.location}:${a.format}:${a.offset}`).join(",");
        return `${b.arrayStride}:${b.stepMode ?? "vertex"}[${attrs}]`;
    })
        .join(";");
    const primitive = desc.primitive;
    const depth = desc.depthStencil;
    const targets = desc.targets
        .map((t) => {
        const blend = t.blend
            ? `${t.blend.color.srcFactor}/${t.blend.color.dstFactor}/${t.blend.color.operation}` +
                `|${t.blend.alpha.srcFactor}/${t.blend.alpha.dstFactor}/${t.blend.alpha.operation}`
            : "-";
        return `${t.format}:${t.writeMask ?? 0xf}:${blend}`;
    })
        .join(",");
    const layouts = desc.bindGroupLayouts
        .map((l) => l.entries.map((e) => `${e.binding}:${e.type}:${e.name ?? ""}:${e.sampleType ?? ""}`).join(","))
        .join(";");
    return [
        `p${programId}`,
        `v${buffers}`,
        `r${primitive?.topology ?? "triangle-list"}:${primitive?.cullMode ?? "none"}:${primitive?.frontFace ?? "ccw"}`,
        `d${depth ? `${depth.format}:${depth.depthWriteEnabled ? 1 : 0}:${depth.depthCompare}` : "none"}`,
        `t${targets}`,
        `m${desc.multisample?.count ?? 1}`,
        `b${layouts}`,
    ].join("|");
}
//# sourceMappingURL=resourceCache.js.map