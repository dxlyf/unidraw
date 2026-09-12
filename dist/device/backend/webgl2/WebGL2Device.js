import { Device } from "../../Device.js";
import { Buffer, Sampler, TextureView } from "../../resources.js";
import { assert, UnidrawError } from "../../../util/assert.js";
import { bindGroupLayoutCacheKey } from "../../descriptors.js";
import { vertexFormatInfo, INDEX_FORMAT_BYTES } from "../../../gpu/formats.js";
import { TextureUsage } from "../../../gpu/types.js";
import { BLEND_FACTORS, BLEND_OPS, COMPARE, INDEX_TYPES, TOPOLOGY_GL } from "./constants.js";
import { GLBindGroup } from "./resources/GLBindGroup.js";
import { GLBindGroupLayout } from "./resources/GLBindGroupLayout.js";
import { GLBuffer } from "./resources/GLBuffer.js";
import { GLProgram } from "./resources/GLProgram.js";
import { GLRenderPipeline } from "./resources/GLRenderPipeline.js";
import { GLSampler } from "./resources/GLSampler.js";
import { GLTexture } from "./resources/GLTexture.js";
import { attributeGLType, describeRenderer, textureGLParams } from "./glUtils.js";
import { flipRowsInPlace, resolveReadRect, swizzleBgraToRgbaInPlace } from "../../readback.js";
import { DEPTH_VIS_ARRAY_FS_GLSL, DEPTH_VIS_FS_GLSL, DEPTH_VIS_VS_GLSL } from "./depthVisualize.js";
const attachmentKey = (a) => `${a.tex.id}_${a.layer}_${a.mip}`;
// ---------------------------------------------------------------------------
// Device
// ---------------------------------------------------------------------------
export class WebGL2Device extends Device {
    gl;
    _uniformBindingCursor = 0;
    _textureUnitCursor = 0;
    _vaos = new Map();
    _fbos = new Map();
    /** MSAA renderbuffer 缓存（key: 格式|尺寸|采样数） */
    _renderbuffers = new Map();
    /** 当前绑定的 VAO（避免重复 bindVertexArray） */
    _boundVao = null;
    /** 上一次绘制用的 VAO 及其指纹（大量 draw 时跳过 key 字符串构造） */
    _lastVao = {
        vao: null,
        pipeline: null,
        indexBuffer: null,
        baseVertex: 0,
        vertexSlot0: null,
        vertexOffset0: 0,
        vertexCount: -1,
    };
    _layoutCache = new Map();
    _uboFree = [];
    _texFree = [];
    _scissorEnabled = false;
    _limits = null;
    /** 是否支持把 RGBA16F/RGBA32F 当作颜色附件（构造时即请求，见构造函数注释） */
    _extColorBufferFloat;
    /** 深度回读用的可视化管线与目标（见 `readDepthPixels`） */
    _depthVisProgram = null;
    _depthVisProgramArray = null;
    _depthVisTarget = null;
    _depthVisSize = [0, 0];
    constructor(canvas, options = {}) {
        const attrs = {
            depth: true,
            stencil: false,
            antialias: options.antialias ?? true,
            alpha: options.alpha ?? false,
            premultipliedAlpha: false,
            preserveDrawingBuffer: false,
            powerPreference: "high-performance",
            failIfMajorPerformanceCaveat: false,
        };
        const gl = canvas.getContext("webgl2", attrs);
        if (!gl)
            throw new UnidrawError("无法创建 WebGL2 上下文：当前环境不支持 WebGL2");
        super("webgl2", canvas, { kind: "webgl2", name: `WebGL2 · ${describeRenderer(gl)}`, adapter: describeRenderer(gl) });
        this.gl = gl;
        this._textureUnitCursor = 1; // 单元 0 保留给内部操作
        // 扩展必须在**任何 framebuffer 操作之前**启用：EXT_color_buffer_float 决定了
        // RGBA16F/RGBA32F 是否可作为颜色附件（可渲染）。若等到 readTexturePixels 里才请求，
        // 之前的 getFramebuffer 已经按「不可渲染」校验过一遍，会误报 Framebuffer 不完整。
        this._extColorBufferFloat = gl.getExtension("EXT_color_buffer_float") !== null;
        // 半浮点渲染 + 浮点线性过滤是 2D/后处理里最常用的两个可选能力，一并提前启用
        gl.getExtension("OES_texture_float_linear");
    }
    get limits() {
        if (!this._limits) {
            const gl = this.gl;
            this._limits = {
                maxVertexAttributes: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
                maxTextureUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
                maxUniformBufferBindings: gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS),
                maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
                minUniformBufferOffsetAlignment: gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) ?? 256,
                maxSamples: gl.getParameter(gl.MAX_SAMPLES) ?? 1,
            };
        }
        return this._limits;
    }
    // -------------------------------------------------------------------------
    // 资源创建
    // -------------------------------------------------------------------------
    createBuffer(desc) {
        return new GLBuffer(this, desc);
    }
    createTexture(desc) {
        assert(desc.format !== "bgra8unorm" && desc.format !== "bgra8unorm-srgb", "WebGL2 后端不支持 bgra 纹理格式");
        return new GLTexture(this, desc);
    }
    createSampler(desc) {
        return new GLSampler(this, desc);
    }
    createProgramNative(desc) {
        return new GLProgram(this, desc);
    }
    createBindGroupLayout(desc) {
        // 内容去重：相同布局共享同一组 UBO binding point / 纹理单元，
        // 防止大量同构材质耗尽有限的 GL binding 资源
        const key = bindGroupLayoutCacheKey(desc);
        const cached = this._layoutCache.get(key);
        if (cached)
            return cached;
        const layout = new GLBindGroupLayout(this, desc);
        this._layoutCache.set(key, layout);
        return layout;
    }
    createBindGroup(desc) {
        return new GLBindGroup(this, desc);
    }
    createRenderPipelineNative(desc) {
        return new GLRenderPipeline(this, desc);
    }
    allocateUniformBinding() {
        const reused = this._uboFree.pop();
        if (reused !== undefined)
            return reused;
        const point = this._uniformBindingCursor++;
        assert(point < this.limits.maxUniformBufferBindings, "UBO binding point 耗尽");
        return point;
    }
    allocateTextureUnit() {
        const reused = this._texFree.pop();
        if (reused !== undefined)
            return reused;
        const unit = this._textureUnitCursor++;
        assert(unit < this.limits.maxTextureUnits - 1, "纹理单元耗尽（保留 1 个给内部操作）");
        return unit;
    }
    freeUniformBinding(point) {
        this._uboFree.push(point);
    }
    freeTextureUnit(unit) {
        this._texFree.push(unit);
    }
    /** 布局销毁时从缓存移除（避免复用已销毁布局）。 */
    dropLayoutCache(layout) {
        for (const [key, value] of this._layoutCache) {
            if (value === layout)
                this._layoutCache.delete(key);
        }
    }
    // -------------------------------------------------------------------------
    // 查询
    // -------------------------------------------------------------------------
    async onSubmittedWorkDone() {
        this.gl.flush();
    }
    presentSize() {
        const c = this.canvas;
        return { width: c?.width ?? 0, height: c?.height ?? 0 };
    }
    canvasFormat() {
        return "rgba8unorm";
    }
    /**
     * 纹理回读：绑定临时 FBO → `readPixels` → 按行序翻转 Y。
     * 注意：会临时切换绑定的 framebuffer，读取后恢复。
     *
     * **翻转规则（与 WebGPU 对齐的关键）**：
     * - 被当作渲染附件写过的纹理（`usedAsAttachment`）：GL 把画面顶部写进内存**最后**一行，
     *   所以要翻转才能得到「左上原点、第一行是画面顶部」的输出 —— WebGPU 无需翻转
     *   （它的 y=0 就是画面顶部），因此两侧输出一致；
     * - 只用 `upload()` 写入过的纹理：第 0 行落在内存第 0 行，翻转反而会得到上下颠倒的
     *   结果（WebGL2 与 WebGPU 的上传行序本来就是一致的），所以**不翻转**。
     *
     * 深度纹理不走 `readPixels`（Chrome 的 WebGL2 没实现这条路径，见 `depthVisualize.ts`），
     * 改为「可视化到 rgba32float 再按颜色回读」。
     */
    async readTexturePixels(texture, options = {}) {
        const gl = this.gl;
        const rect = resolveReadRect(texture, options);
        const tex = texture;
        if (rect.depth)
            return this.readDepthPixels(tex, rect);
        const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        // 分层/分面回读：把 `layer` 指定的那一层挂成颜色附件（cube 是面序号）
        const fb = this.getFramebuffer({ tex, layer: rect.layer, mip: 0 }, null);
        // GL 的 readPixels 原点在左下：把「左上 y」换算成 GL 的行起点
        const glY = texture.height - (rect.y + rect.height);
        if (rect.float) {
            if (!this._extColorBufferFloat) {
                throw new UnidrawError("[unidraw] 浮点纹理回读需要 WebGL2 的 EXT_color_buffer_float 扩展");
            }
            const rgba = new Float32Array(rect.width * rect.height * 4);
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.readPixels(rect.x, glY, rect.width, rect.height, gl.RGBA, gl.FLOAT, rgba);
            gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
            if (tex.usedAsAttachment)
                flipRowsInPlace(new Uint8Array(rgba.buffer), rect.width, rect.height, 16);
            return new Uint8Array(rgba.buffer);
        }
        const out = new Uint8Array(rect.width * rect.height * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.readPixels(rect.x, glY, rect.width, rect.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
        gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
        if (tex.usedAsAttachment)
            flipRowsInPlace(out, rect.width, rect.height);
        if (rect.bgra)
            swizzleBgraToRgbaInPlace(out);
        return out;
    }
    /**
     * 深度回读：深度纹理 → （深度可视化 pass）→ rgba32float 颜色纹理 → 普通颜色回读。
     *
     * 结果布局与浮点深度回读一致：每纹素 16 字节，R = 深度，GBA = 0/0/1
     * （着色器直接写成这个布局），行序与颜色回读相同（左上原点，与 WebGPU 一致）。
     * 需要 `EXT_color_buffer_float`（rgba32float 可渲染）；没有扩展时明确报错，
     * 而不是静默返回全 0。
     */
    readDepthPixels(tex, rect) {
        const gl = this.gl;
        if (!this._extColorBufferFloat) {
            throw new UnidrawError("[unidraw] WebGL2 深度回读需要 EXT_color_buffer_float（深度要可视化到 rgba32float 才能读出浮点值）");
        }
        // 可视化着色器按 `sampler2D` / `sampler2DArray` 采样：cube 深度没有对应写法
        // （ES 3.0 不能对 samplerCube 做 texelFetch），这里明确拒绝而不是给出错误数据。
        if (tex.dimension === "cube" || tex.dimension === "3d") {
            throw new UnidrawError(`[unidraw] WebGL2 的深度回读不支持 ${tex.dimension} 深度纹理（支持 2d 与 2d-array）：` +
                "cube/3D 深度请先各自可视化到颜色目标再回读");
        }
        const layered = tex.dimension === "2d-array";
        const target = this.depthVisTarget(rect.width, rect.height);
        const program = this.depthVisProgram(layered);
        const glProgram = program.linkedProgram();
        const fb = this.getFramebuffer({ tex: target, layer: 0, mip: 0 }, null);
        // 这次绘制绕过了 executeOps 的状态跟踪，状态要成套存/还原
        const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM);
        const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
        const prevActive = gl.getParameter(gl.ACTIVE_TEXTURE);
        const prevTex0 = gl.getParameter(gl.TEXTURE_BINDING_2D);
        const prevTex2dArray = gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY);
        const scissorWas = gl.getParameter(gl.SCISSOR_TEST);
        const depthWas = gl.getParameter(gl.DEPTH_TEST);
        const blendWas = gl.getParameter(gl.BLEND);
        const cullWas = gl.getParameter(gl.CULL_FACE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.viewport(0, 0, rect.width, rect.height);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.disable(gl.CULL_FACE);
        gl.colorMask(true, true, true, true);
        gl.useProgram(glProgram);
        gl.bindVertexArray(null); // 顶点由 gl_VertexID 生成，不需要任何属性
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(layered ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D, tex.glTexture);
        gl.uniform4f(program.uniformLocation("u_rect"), rect.x, rect.y, rect.width, rect.height);
        gl.uniform1i(program.uniformLocation("u_depth"), 0);
        if (layered)
            gl.uniform1i(program.uniformLocation("u_layer"), rect.layer);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const rgba = new Float32Array(rect.width * rect.height * 4);
        gl.readPixels(0, 0, rect.width, rect.height, gl.RGBA, gl.FLOAT, rgba);
        // 还原：framebuffer / program / VAO / 纹理单元 / 开关状态
        gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
        gl.useProgram(prevProgram);
        gl.bindVertexArray(prevVao);
        gl.activeTexture(prevActive);
        gl.bindTexture(gl.TEXTURE_2D, prevTex0);
        if (layered)
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, prevTex2dArray);
        if (scissorWas)
            gl.enable(gl.SCISSOR_TEST);
        if (depthWas)
            gl.enable(gl.DEPTH_TEST);
        if (blendWas)
            gl.enable(gl.BLEND);
        if (cullWas)
            gl.enable(gl.CULL_FACE);
        this._boundVao = null; // executeOps 会重新 setupVao
        flipRowsInPlace(new Uint8Array(rgba.buffer), rect.width, rect.height, 16);
        return new Uint8Array(rgba.buffer);
    }
    /** 深度可视化用的着色器（GLSL，无顶点属性；分层用 sampler2DArray 版本） */
    depthVisProgram(layered) {
        const cached = layered ? this._depthVisProgramArray : this._depthVisProgram;
        if (cached)
            return cached;
        const program = new GLProgram(this, {
            label: layered ? "depth-visualize-array" : "depth-visualize",
            glsl: { vertex: DEPTH_VIS_VS_GLSL, fragment: layered ? DEPTH_VIS_ARRAY_FS_GLSL : DEPTH_VIS_FS_GLSL },
        });
        if (layered)
            this._depthVisProgramArray = program;
        else
            this._depthVisProgram = program;
        return program;
    }
    /** 深度可视化目标（rgba32float，按回读尺寸缓存一张） */
    depthVisTarget(width, height) {
        if (this._depthVisTarget && this._depthVisSize[0] === width && this._depthVisSize[1] === height)
            return this._depthVisTarget;
        this._depthVisTarget?.destroy();
        const target = this.createTexture({
            label: "depth-visualize",
            width,
            height,
            format: "rgba32float",
            usage: TextureUsage.RENDER_ATTACHMENT,
        });
        this._depthVisTarget = target;
        this._depthVisSize = [width, height];
        return target;
    }
    // -------------------------------------------------------------------------
    // 命令执行
    // -------------------------------------------------------------------------
    executeOps(ops) {
        const gl = this.gl;
        let inPass = false;
        let currentPipeline = null;
        const groups = [null, null, null, null];
        const vertexBuffers = new Map();
        let indexBuffer = null;
        let targetWidth = 0;
        let targetHeight = 0;
        /** 当前 pass 若是 MSAA，则记录源 FBO 与解析目标（endRenderPass 时 blit） */
        let msaaSourceFb = null;
        let msaaResolveTarget = null;
        /** 当前 pass 的附件高度（scissor/viewport 的 Y 翻转用） */
        let passHeight = 0;
        const resetPass = () => {
            currentPipeline = null;
            groups.fill(null);
            vertexBuffers.clear();
            indexBuffer = null;
        };
        for (const op of ops) {
            switch (op.k) {
                case "beginRenderPass": {
                    assert(!inPass, "beginRenderPass 嵌套非法");
                    const colorAtt = op.colorAttachments[0];
                    const colorView = colorAtt?.view;
                    const colorTex = colorView?.texture;
                    // 没有任何颜色附件（`colorAttachments: []`）= 只写深度的 pass（阴影贴图）
                    const depthOnly = op.colorAttachments.length === 0;
                    const toCanvas = !depthOnly && (colorAtt === null || colorAtt?.view === null);
                    const depthAtt = op.depthStencilAttachment;
                    const depthView = depthAtt?.view;
                    const depthTex = depthView?.texture;
                    const scissorWas = this._scissorEnabled;
                    // 分层 attachment：视图带层号时只挂那一层（cube 是面序号）
                    const colorAspect = colorTex
                        ? { tex: colorTex, layer: colorView?.baseArrayLayer ?? 0, mip: colorView?.mipLevel ?? 0 }
                        : null;
                    const depthAspect = depthTex
                        ? { tex: depthTex, layer: depthView?.baseArrayLayer ?? 0, mip: depthView?.mipLevel ?? 0 }
                        : null;
                    if (toCanvas) {
                        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                        targetWidth = this.canvas?.width ?? 0;
                        targetHeight = this.canvas?.height ?? 0;
                    }
                    else {
                        const msaa = (colorTex?.sampleCount ?? 1) > 1 || (depthTex?.sampleCount ?? 1) > 1;
                        if (msaa) {
                            // MSAA 附件走 renderbuffer，只有整层可用：分层 + 多重采样在 GL 里做不到
                            if ((colorAspect && colorAspect.layer !== 0) || (depthAspect && depthAspect.layer !== 0)) {
                                assert(false, "WebGL2 不支持分层的多重采样附件：分层渲染目标请用 sampleCount: 1");
                            }
                        }
                        const fb = msaa
                            ? this.getMsaaFramebuffer(colorTex ?? null, depthTex ?? null)
                            : this.getFramebuffer(colorAspect, depthAspect);
                        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
                        msaaSourceFb = msaa ? fb : null;
                        msaaResolveTarget = msaa ? (colorAtt?.resolveTo?.texture ?? null) : null;
                        // MSAA 目标本身是 renderbuffer 的「标识纹理」，真正拿到渲染结果的是 resolve
                        // 目标（blit 复制行序不变），所以它同样要标记成「渲染过的纹理」。
                        if (msaaResolveTarget)
                            msaaResolveTarget.usedAsAttachment = true;
                        const count = op.colorAttachments.filter((a) => a !== null).length;
                        if (count === 0) {
                            // 深度专用 FBO：不能引用不存在的颜色附件
                            assert(depthTex != null, "没有颜色附件时必须提供深度附件");
                            gl.drawBuffers([gl.NONE]);
                        }
                        else {
                            const bufs = [];
                            for (let i = 0; i < count; i++)
                                bufs.push(gl.COLOR_ATTACHMENT0 + i);
                            gl.drawBuffers(bufs);
                        }
                        targetWidth = colorTex?.width ?? depthTex?.width ?? 0;
                        targetHeight = colorTex?.height ?? depthTex?.height ?? 0;
                        // 「被当作渲染附件写过」的纹理在内存里是 GL 行序（第 0 行 = 画面下方），
                        // 回读时要翻转；只用 upload() 写入过的纹理则保持上传行序。见 readTexturePixels。
                        if (colorTex)
                            colorTex.usedAsAttachment = true;
                        if (depthTex)
                            depthTex.usedAsAttachment = true;
                    }
                    passHeight = targetHeight;
                    // 清屏不受 scissor 影响
                    if (scissorWas)
                        gl.disable(gl.SCISSOR_TEST);
                    gl.depthMask(true);
                    const clearColor = colorAtt && colorAtt.loadOp === "clear";
                    if (colorAtt && clearColor) {
                        const c = colorAtt.clearValue;
                        gl.clearColor(c?.r ?? 0, c?.g ?? 0, c?.b ?? 0, c?.a ?? 1);
                        gl.clear(gl.COLOR_BUFFER_BIT);
                    }
                    const clearDepth = depthAtt != null && depthAtt.depthLoadOp === "clear";
                    if (clearDepth) {
                        // 注意：无论深度附件是 canvas 默认深度还是**显式深度纹理**，都必须清 ——
                        // 显式纹理上一次 pass 的深度会残留，导致本次 pass 的物体被“幽灵深度”挡住
                        // （离屏渲染/ID 拾取在 WebGL2 上表现为物体缺失或拾取到错误对象）。
                        gl.clearDepth(depthAtt.depthClearValue ?? 1);
                        gl.clear(gl.DEPTH_BUFFER_BIT);
                    }
                    if (scissorWas) {
                        gl.enable(gl.SCISSOR_TEST);
                        this._scissorEnabled = true;
                    }
                    inPass = true;
                    resetPass();
                    gl.viewport(0, 0, targetWidth, targetHeight);
                    gl.disable(gl.SCISSOR_TEST);
                    this._scissorEnabled = false;
                    break;
                }
                case "endRenderPass": {
                    assert(inPass, "endRenderPass 无对应 beginRenderPass");
                    inPass = false;
                    resetPass();
                    // MSAA：把多重采样附件解析到目标纹理（WebGPU 的 resolveTarget 语义）
                    if (msaaSourceFb && msaaResolveTarget) {
                        this.resolveMsaa(msaaSourceFb, msaaResolveTarget);
                    }
                    msaaSourceFb = null;
                    msaaResolveTarget = null;
                    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                    gl.disable(gl.SCISSOR_TEST);
                    this._scissorEnabled = false;
                    break;
                }
                case "setPipeline": {
                    assert(inPass, "setPipeline 必须在 render pass 内");
                    const p = op.pipeline;
                    // 状态最小化：同一 pass 内重复设置同一管线时跳过（useProgram + 状态设置）
                    if (currentPipeline !== p) {
                        gl.useProgram(p.glProgram.linkedProgram());
                        this.applyPipelineState(p);
                        currentPipeline = p;
                    }
                    break;
                }
                case "setBindGroup": {
                    assert(inPass, "setBindGroup 必须在 render pass 内");
                    const bg = op.group;
                    groups[op.index] = bg;
                    if (bg)
                        this.bindGroup(bg, op);
                    break;
                }
                case "setVertexBuffer": {
                    assert(inPass, "setVertexBuffer 必须在 render pass 内");
                    if (op.buffer)
                        vertexBuffers.set(op.slot, { buffer: op.buffer, offset: op.offset });
                    else
                        vertexBuffers.delete(op.slot);
                    break;
                }
                case "setIndexBuffer": {
                    assert(inPass, "setIndexBuffer 必须在 render pass 内");
                    indexBuffer = op.buffer ? { buffer: op.buffer, format: op.format, offset: op.offset } : null;
                    break;
                }
                case "setViewport": {
                    // 统一 API/WebGPU 约定：左上原点；GL 原点在左下 → 翻转 Y
                    const vpY = passHeight - (op.y + op.height);
                    gl.viewport(op.x, vpY, op.width, op.height);
                    break;
                }
                case "setScissorRect": {
                    gl.enable(gl.SCISSOR_TEST);
                    this._scissorEnabled = true;
                    const scY = passHeight - (op.y + op.height);
                    gl.scissor(op.x, scY, op.width, op.height);
                    break;
                }
                case "draw":
                case "drawIndexed": {
                    assert(inPass && currentPipeline, "draw 前必须 setPipeline");
                    this.drawPrimitive(currentPipeline, indexBuffer, op, vertexBuffers);
                    break;
                }
                case "pushDebugGroup":
                case "popDebugGroup":
                    break;
                default: {
                    const exhaustive = op;
                    throw new UnidrawError(`[unidraw] 未知命令 op：${JSON.stringify(exhaustive)}`);
                }
            }
        }
    }
    /** 当前绑定的 VAO（`GLBuffer` 写索引缓冲时需要保存/恢复，见 `GLBuffer.elementBindingSafe`） */
    get boundVao() {
        return this._boundVao;
    }
    /** 应用管线静态状态（深度/剔除/混合）。 */
    applyPipelineState(p) {
        const gl = this.gl;
        const d = p.descriptor;
        const ds = d.depthStencil;
        if (ds) {
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(COMPARE[ds.depthCompare]);
            gl.depthMask(ds.depthWriteEnabled);
        }
        else {
            gl.disable(gl.DEPTH_TEST);
            gl.depthMask(false);
        }
        const cull = d.primitive?.cullMode ?? "none";
        if (cull === "none") {
            gl.disable(gl.CULL_FACE);
        }
        else {
            gl.enable(gl.CULL_FACE);
            gl.cullFace(cull === "back" ? gl.BACK : gl.FRONT);
            gl.frontFace((d.primitive?.frontFace ?? "ccw") === "ccw" ? gl.CCW : gl.CW);
        }
        const target = d.targets[0];
        const blend = target?.blend;
        if (blend) {
            gl.enable(gl.BLEND);
            gl.blendFuncSeparate(BLEND_FACTORS[blend.color.srcFactor], BLEND_FACTORS[blend.color.dstFactor], BLEND_FACTORS[blend.alpha.srcFactor], BLEND_FACTORS[blend.alpha.dstFactor]);
            gl.blendEquationSeparate(BLEND_OPS[blend.color.operation], BLEND_OPS[blend.alpha.operation]);
            const mask = target.writeMask ?? 0xf;
            gl.colorMask((mask & 1) !== 0, (mask & 2) !== 0, (mask & 4) !== 0, (mask & 8) !== 0);
        }
        else {
            gl.disable(gl.BLEND);
            gl.colorMask(true, true, true, true);
        }
        // sampler uniform 指向每个 layout 分配的纹理单元
        for (const layout of d.bindGroupLayouts) {
            const glLayout = layout;
            let texIdx = 0;
            for (const entry of layout.entries) {
                if (entry.type !== "texture")
                    continue;
                const name = entry.name;
                const loc = name ? p.glProgram.uniformLocation(name) : null;
                if (loc)
                    gl.uniform1i(loc, glLayout.textureUnits[texIdx]);
                texIdx++;
            }
        }
    }
    bindGroup(bg, op) {
        const gl = this.gl;
        const layout = bg.descriptor.layout;
        const byBinding = new Map(bg.descriptor.entries.map((e) => [e.binding, e]));
        // UBO（动态偏移 entry 按顺序消费内联偏移；无偏移时退化为 bindBufferBase）
        let uboIdx = 0;
        let dynIdx = 0;
        for (const entry of layout.entries) {
            if (entry.type !== "uniform-buffer")
                continue;
            const binding = byBinding.get(entry.binding);
            const res = binding?.resource;
            if (res instanceof Buffer) {
                const glBuffer = res.glBuffer;
                const dynamic = entry.hasDynamicOffset === true;
                const dynOffset = dynamic ? (dynIdx === 0 ? op.offset0 : op.offset1) : 0;
                if (dynamic)
                    dynIdx++;
                const base = binding?.offset ?? 0;
                if (dynamic || binding?.offset || binding?.size) {
                    const size = binding?.size ?? Math.max(0, res.size - base);
                    gl.bindBufferRange(gl.UNIFORM_BUFFER, layout.uboPoints[uboIdx], glBuffer, base + dynOffset, size);
                }
                else {
                    gl.bindBufferBase(gl.UNIFORM_BUFFER, layout.uboPoints[uboIdx], glBuffer);
                }
            }
            uboIdx++;
        }
        // texture + sampler（按 entry 顺序配对）
        const textures = layout.entries.filter((e) => e.type === "texture");
        const samplers = layout.entries.filter((e) => e.type === "sampler");
        textures.forEach((texEntry, i) => {
            const unit = layout.textureUnits[i];
            const res = byBinding.get(texEntry.binding)?.resource;
            gl.activeTexture(gl.TEXTURE0 + unit);
            if (res instanceof TextureView)
                gl.bindTexture(gl.TEXTURE_2D, res.texture.glTexture);
            else
                gl.bindTexture(gl.TEXTURE_2D, null);
            const samRes = samplers[i] ? byBinding.get(samplers[i].binding)?.resource : undefined;
            if (samRes instanceof Sampler)
                gl.bindSampler(unit, samRes.glSampler);
            else
                gl.bindSampler(unit, null);
        });
    }
    drawPrimitive(pipeline, index, op, vertexBuffers) {
        const gl = this.gl;
        const topology = (pipeline.descriptor.primitive?.topology ?? "triangle-list");
        const mode = TOPOLOGY_GL[topology];
        const baseVertex = op.k === "drawIndexed" ? op.baseVertex : 0;
        // 大量 draw 时最常见的形态是「同一 pipeline + 同一批缓冲 + 同一 baseVertex 连续绘制」，
        // 用一次性缓存跳过 VAO key 字符串构造与 Map 查询
        const cache = this._lastVao;
        let vao;
        const simpleCase = vertexBuffers.size <= 1; // 多顶点流时退化为 key 查表，保证正确性
        if (simpleCase &&
            cache.vao &&
            cache.pipeline === pipeline &&
            cache.indexBuffer === (index?.buffer ?? null) &&
            cache.baseVertex === baseVertex &&
            cache.vertexSlot0 === (vertexBuffers.get(0)?.buffer ?? null) &&
            cache.vertexOffset0 === (vertexBuffers.get(0)?.offset ?? 0) &&
            cache.vertexCount === vertexBuffers.size) {
            vao = cache.vao;
        }
        else {
            const key = this.vaoKey(pipeline, vertexBuffers, index?.buffer ?? null, baseVertex);
            vao = this._vaos.get(key) ?? null;
            if (!vao) {
                vao = gl.createVertexArray();
                if (!vao)
                    throw new UnidrawError("createVertexArray 失败");
                this._vaos.set(key, vao);
                this.setupVao(pipeline, vertexBuffers, index?.buffer ?? null, baseVertex, vao);
            }
            if (simpleCase) {
                cache.vao = vao;
                cache.pipeline = pipeline;
                cache.indexBuffer = index?.buffer ?? null;
                cache.baseVertex = baseVertex;
                cache.vertexSlot0 = vertexBuffers.get(0)?.buffer ?? null;
                cache.vertexOffset0 = vertexBuffers.get(0)?.offset ?? 0;
                cache.vertexCount = vertexBuffers.size;
            }
            else {
                cache.vao = null;
            }
        }
        if (this._boundVao !== vao) {
            gl.bindVertexArray(vao);
            this._boundVao = vao;
        }
        if (op.k === "draw") {
            gl.drawArraysInstanced(mode, op.firstVertex, op.vertexCount, op.instanceCount);
        }
        else {
            if (!index)
                throw new UnidrawError("drawIndexed 需要 setIndexBuffer");
            const byteOffset = index.offset + op.firstIndex * INDEX_FORMAT_BYTES[index.format];
            gl.drawElementsInstanced(mode, op.indexCount, INDEX_TYPES[index.format], byteOffset, op.instanceCount);
        }
    }
    vaoKey(pipeline, vertexBuffers, indexBuffer, baseVertex) {
        const parts = [`p${pipeline.id}`, `b${baseVertex}`];
        const slots = [...vertexBuffers.keys()].sort((a, b) => a - b);
        for (const slot of slots) {
            const vb = vertexBuffers.get(slot);
            parts.push(`s${slot}:${vb.buffer.id}@${vb.offset}`);
        }
        parts.push(indexBuffer ? `i${indexBuffer.id}` : "i0");
        return parts.join("|");
    }
    setupVao(pipeline, vertexBuffers, indexBuffer, baseVertex, vao) {
        const gl = this.gl;
        gl.bindVertexArray(vao);
        for (let loc = 0; loc < this.limits.maxVertexAttributes; loc++)
            gl.disableVertexAttribArray(loc);
        const buffers = pipeline.descriptor.vertex.buffers;
        for (let slot = 0; slot < buffers.length; slot++) {
            const layout = buffers[slot];
            const binding = layout ? vertexBuffers.get(slot) : undefined;
            if (!layout || !binding)
                continue;
            gl.bindBuffer(gl.ARRAY_BUFFER, binding.buffer.glBuffer);
            const stride = layout.arrayStride;
            const divisor = (layout.stepMode ?? "vertex") === "instance" ? 1 : 0;
            for (const attr of layout.attributes) {
                const info = vertexFormatInfo(attr.format);
                const baseAdd = baseVertex * (stride > 0 ? stride : info.size);
                const offset = binding.offset + attr.offset + baseAdd;
                gl.enableVertexAttribArray(attr.location);
                const glType = attributeGLType(this.gl, info.glType);
                if (info.integer) {
                    gl.vertexAttribIPointer(attr.location, info.components, glType, stride, offset);
                }
                else {
                    gl.vertexAttribPointer(attr.location, info.components, glType, info.normalized, stride, offset);
                }
                gl.vertexAttribDivisor(attr.location, divisor);
            }
        }
        if (indexBuffer)
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer.glBuffer);
        gl.bindVertexArray(null);
        this._boundVao = null; // setupVao 结尾解绑，保持状态跟踪一致
    }
    /**
     * 把一张纹理的某一层挂到附件点上。
     *
     * 三种挂法不能混：cube 只能用**面目标**（`TEXTURE_CUBE_MAP_POSITIVE_X + layer`，
     * `framebufferTextureLayer` 对 cube 无效、FBO 会不完整）；2D 数组/3D 用
     * `framebufferTextureLayer`；普通 2D 用 `framebufferTexture2D`。
     */
    attachTexture(attachment, a) {
        const gl = this.gl;
        const t = a.tex;
        if (t.dimension === "cube") {
            gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_CUBE_MAP_POSITIVE_X + a.layer, t.glTexture, a.mip);
        }
        else if (t.dimension === "3d" || t.dimension === "2d-array") {
            gl.framebufferTextureLayer(gl.FRAMEBUFFER, attachment, t.glTexture, a.mip, a.layer);
        }
        else {
            gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, t.glTexture, a.mip);
        }
    }
    getFramebuffer(color, depth) {
        const gl = this.gl;
        const key = `c${color ? attachmentKey(color) : "0"}d${depth ? attachmentKey(depth) : "0"}`;
        const cached = this._fbos.get(key);
        if (cached)
            return cached;
        const fb = gl.createFramebuffer();
        assert(fb, "createFramebuffer 失败");
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        if (color)
            this.attachTexture(gl.COLOR_ATTACHMENT0, color);
        if (depth)
            this.attachTexture(gl.DEPTH_ATTACHMENT, depth);
        // 只有深度附件时必须把 draw buffer 关掉（默认指向不存在的 COLOR_ATTACHMENT0 →
        // FRAMEBUFFER_INCOMPLETE_ATTACHMENT）。深度回读、深度可视化都会走这条路径。
        if (!color) {
            gl.drawBuffers([gl.NONE]);
            // read buffer 同样要关：readPixels 读 DEPTH_COMPONENT 时若 read buffer 不是 NONE，
            // WebGL2 直接报 INVALID_OPERATION（缓冲全 0，且不会抛异常，很容易误判成「深度值不对」）。
            gl.readBuffer(gl.NONE);
        }
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        assert(status === gl.FRAMEBUFFER_COMPLETE, `Framebuffer 不完整：0x${status.toString(16)}`);
        this._fbos.set(key, fb);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return fb;
    }
    /**
     * 多重采样 attachment 用的 renderbuffer。
     *
     * **必须按纹理身份缓存，不能按 格式×尺寸×采样数 缓存**：那样「同尺寸同采样的多张
     * MSAA 目标」会共用同一个 renderbuffer，于是 A 的 pass 一清屏就把 B 的内容抹掉。
     * 一帧里只有一张 MSAA 目标时看不出问题，但 render2d 的阴影遮罩、图层模式的
     * ping-pong 图层都是同尺寸 MSAA 目标 —— 表现是「阴影渲染完之后图层内容全没了、
     * 整幅几乎空白」。纹理销毁时用 `releaseMsaaResources` 回收。
     */
    getRenderbuffer(texture) {
        const gl = this.gl;
        const key = `rb${texture.id}`;
        const cached = this._renderbuffers.get(key);
        if (cached)
            return cached;
        const rb = gl.createRenderbuffer();
        assert(rb, "createRenderbuffer 失败");
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
        const params = textureGLParams(gl, texture.format);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, texture.sampleCount, params.internal, texture.width, texture.height);
        gl.bindRenderbuffer(gl.RENDERBUFFER, null);
        this._renderbuffers.set(key, rb);
        return rb;
    }
    /** 纹理销毁时回收它独占的 renderbuffer 与相关 FBO（见 `getRenderbuffer` 的说明） */
    releaseMsaaResources(textureId) {
        const gl = this.gl;
        const rbKey = `rb${textureId}`;
        const rb = this._renderbuffers.get(rbKey);
        if (rb) {
            gl.deleteRenderbuffer(rb);
            this._renderbuffers.delete(rbKey);
        }
        for (const [key, fb] of this._fbos) {
            const m = /c(\d+)_\d+_\d+d(\d+)_\d+_\d+/.exec(key);
            if (m && (Number(m[1]) === textureId || Number(m[2]) === textureId)) {
                gl.deleteFramebuffer(fb);
                this._fbos.delete(key);
            }
        }
    }
    /** MSAA framebuffer：颜色/深度都用多重采样 renderbuffer；解析目标在 pass 结束时 blit。 */
    getMsaaFramebuffer(color, depth) {
        const gl = this.gl;
        const key = `msaa:c${color ? color.id : 0}_0_0d${depth ? depth.id : 0}_0_0s${color?.sampleCount ?? depth?.sampleCount ?? 1}`;
        const cached = this._fbos.get(key);
        if (cached)
            return cached;
        const fb = gl.createFramebuffer();
        assert(fb, "createFramebuffer 失败");
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        if (color)
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.getRenderbuffer(color));
        if (depth)
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.getRenderbuffer(depth));
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        assert(status === gl.FRAMEBUFFER_COMPLETE, `MSAA Framebuffer 不完整：0x${status.toString(16)}`);
        this._fbos.set(key, fb);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return fb;
    }
    /** 把多重采样附件解析（resolve）到普通纹理。 */
    resolveMsaa(source, target) {
        const gl = this.gl;
        const tex = target;
        // 解析目标一定是单层 2D 纹理（MSAA 分层组合在 GL 里不存在，见 beginRenderPass）
        const dst = this.getFramebuffer({ tex, layer: 0, mip: 0 }, null);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst);
        gl.blitFramebuffer(0, 0, tex.width, tex.height, 0, 0, tex.width, tex.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }
    destroyNative() {
        for (const vao of this._vaos.values())
            this.gl.deleteVertexArray(vao);
        this._vaos.clear();
        for (const fb of this._fbos.values())
            this.gl.deleteFramebuffer(fb);
        this._fbos.clear();
        for (const rb of this._renderbuffers.values())
            this.gl.deleteRenderbuffer(rb);
        this._renderbuffers.clear();
        this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
}
//# sourceMappingURL=WebGL2Device.js.map