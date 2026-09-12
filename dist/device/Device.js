import { assert } from "../util/assert.js";
import { logger } from "../util/logger.js";
import { CommandEncoder } from "../command/encoder.js";
import { ResourceBase, } from "./resources.js";
import { pipelineCacheKey, programCacheKey } from "./resourceCache.js";
/**
 * 统一设备抽象：创建资源、编码并提交命令。
 *
 * 三种实现：
 * - WebGL2Device —— 同步 API 后端
 * - WebGPUDevice —— 异步 API 后端
 * - MockDevice   —— 无头 CPU 后端（测试 / SSR）
 */
export class Device extends ResourceBase {
    kind;
    canvas;
    info;
    _resources = [];
    _beforeSubmit = new Set();
    _programCache = new Map();
    _pipelineCache = new Map();
    _programsCreated = 0;
    _pipelinesCreated = 0;
    _submitCount = 0;
    constructor(kind, canvas, info) {
        super(info.name);
        this.kind = kind;
        this.canvas = canvas;
        this.info = info;
    }
    /**
     * 已提交次数。后端的 `submit()` 会 +1。
     *
     * 用途：判断「上一次提交是否已经发生」——提交之后写 buffer 才保证在队列时间线上
     * 晚于上一次提交的绘制，因此可以安全复用动态偏移 UBO 的槽位。
     */
    get submitCount() {
        return this._submitCount;
    }
    /** @internal 由后端在真正提交后调用。 */
    markSubmitted() {
        this._submitCount++;
    }
    /**
     * 创建着色器程序（**带内容缓存**）：源码完全相同的程序只创建一次。
     *
     * 典型场景：多个材质用同一套内置着色器（例如 25 个球各一个 `ColorMaterial`），
     * 缓存后 GL 程序 / WGSL 模块只编译一次。
     */
    createProgram(desc) {
        const key = programCacheKey(desc);
        const cached = this._programCache.get(key);
        if (cached && !cached.destroyed)
            return cached;
        const program = this.createProgramNative(desc);
        this._programCache.set(key, program);
        this._programsCreated++;
        return program;
    }
    /**
     * 创建渲染管线（**带内容缓存**）：程序 + 顶点布局 + 光栅/深度/目标/采样数
     * 完全相同的管线只创建一次。
     */
    createRenderPipeline(desc) {
        const key = pipelineCacheKey(desc, programIdOf(desc.program));
        const cached = this._pipelineCache.get(key);
        if (cached && !cached.destroyed)
            return cached;
        const pipeline = this.createRenderPipelineNative(desc);
        this._pipelineCache.set(key, pipeline);
        this._pipelinesCreated++;
        return pipeline;
    }
    /** 实际创建的着色器程序数量（去重后；调试/自检用） */
    get programsCreated() {
        return this._programsCreated;
    }
    /** 实际创建的渲染管线数量（去重后；调试/自检用） */
    get pipelinesCreated() {
        return this._pipelinesCreated;
    }
    /** 创建命令编码器（与后端无关的通用实现）。 */
    createCommandEncoder(label) {
        return new CommandEncoder(label);
    }
    // -------------------------------------------------------------------------
    // 提交
    // -------------------------------------------------------------------------
    /**
     * 提交命令缓冲。WebGL2 同步执行；WebGPU 异步执行；
     * Mock 在 CPU 状态模型上执行。可提交同一 CommandBuffer 多次（重放）。
     */
    submit(commandBuffers) {
        assert(!this.destroyed, "Device 已销毁，无法 submit");
        // 合并的 UBO 写入等必须在命令生效前落地（见 onBeforeSubmit）
        this.runBeforeSubmitHooks();
        for (const buffer of commandBuffers) {
            this.executeOps(buffer.ops);
        }
        this.markSubmitted();
    }
    // -------------------------------------------------------------------------
    // 内部
    // -------------------------------------------------------------------------
    /**
     * 登记资源到设备生命周期（设备销毁时统一释放）。
     * @internal 由后端资源构造函数调用
     */
    register(resource) {
        this._resources.push(resource);
        return resource;
    }
    /**
     * 注册「提交前」回调：在 `submit()` 把命令交给 GPU **之前**执行。
     *
     * 用途：把一帧内累积的 UBO 写入合并成一次 `buffer.write`（逐 draw 写 64B 在
     * WebGPU 上是 6000 次队列操作，合并后只剩几次）；回调里写 buffer 在两种后端
     * 都保证先于本帧的 draw 生效（后端在 submit 时才翻译/编码命令）。
     *
     * @returns 取消注册
     */
    onBeforeSubmit(callback) {
        this._beforeSubmit.add(callback);
        return () => this._beforeSubmit.delete(callback);
    }
    /** @internal 由后端在提交前调用。 */
    runBeforeSubmitHooks() {
        if (this._beforeSubmit.size === 0)
            return;
        for (const cb of this._beforeSubmit)
            cb();
    }
    destroy() {
        if (this.destroyed)
            return;
        this.markDestroyed();
        this._beforeSubmit.clear();
        this._programCache.clear();
        this._pipelineCache.clear();
        for (const r of this._resources) {
            if (!r.destroyed)
                r.destroy();
        }
        this._resources.length = 0;
        this.destroyNative();
        logger.info(`device "${this.info.name}" 已销毁`);
    }
}
/** 每个 Program 一个稳定 id（管线指纹用它代替长源码指纹） */
const programIds = new WeakMap();
let nextProgramId = 1;
function programIdOf(program) {
    let id = programIds.get(program);
    if (id === undefined) {
        id = nextProgramId++;
        programIds.set(program, id);
    }
    return id;
}
//# sourceMappingURL=Device.js.map