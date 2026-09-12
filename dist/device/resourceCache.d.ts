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
import type { ProgramDescriptor, RenderPipelineDescriptor } from "./descriptors.js";
/** 32 位 FNV-1a：把长源码折成短 key（Map 里比较短字符串更快） */
export declare function hashString(text: string): string;
/** 程序指纹：GLSL 顶点/片元 + WGSL 模块（含入口名） */
export declare function programCacheKey(desc: ProgramDescriptor): string;
/**
 * 管线指纹：程序 id + 顶点布局 + 光栅状态 + 深度状态 + 颜色目标 + 采样数。
 *
 * `programId` 由设备侧按 Program 对象分配（同一份程序源码共享同一个 Program，
 * 因此这里用 id 就等价于用源码指纹，但更便宜）。
 */
export declare function pipelineCacheKey(desc: RenderPipelineDescriptor, programId: number): string;
//# sourceMappingURL=resourceCache.d.ts.map