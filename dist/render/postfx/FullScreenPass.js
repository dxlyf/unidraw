/**
 * 后处理效果契约 + 全屏 pass 基类。
 *
 * - `PostEffect`：一个后处理步骤（可多趟）。`EffectComposer` 按顺序执行，
 *   把上一步的输出纹理作为下一步的输入；
 * - `FullScreenPass`：最常见的「1 输入 + 画进当前附件」效果基类 ——
 *   只需要一对 fragment shader（GLSL ES 3.00 + WGSL），顶点阶段用
 *   `gl_VertexID` / `@builtin(vertex_index)` 生成覆盖屏幕的三角形（`draw(3)`，无需顶点缓冲）。
 *
 * 统一 bind group（0）：
 * | binding | 内容 |
 * | --- | --- |
 * | 0 | `ParamsBlock` UBO：`u_texelSize`(尺寸, 1/尺寸) / `u_params` / `u_params2` |
 * | 1 | 输入纹理 |
 * | 2 | 采样器（linear + clamp） |
 * | 3.. | 额外纹理（`extraTextureCount`，例如泛光图） |
 */
import { TextureUsage } from "../../gpu/types.js";
import { UniformBlock } from "../UniformBlock.js";
import { textureFormatInfo } from "../../gpu/formats.js";
/** 直通 alpha 的 source-over（render2d 的阴影/图层合成都用它） */
export const STRAIGHT_OVER = {
    color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};
const OVER_BLEND = {
    color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};
export class FullScreenPass {
    name;
    inputCount = 1;
    device;
    params;
    pipeline;
    layout;
    sampler;
    _extraCount;
    _extras = [];
    _placeholder = null;
    constructor(device, options) {
        this.device = device;
        this.name = options.name;
        this._extraCount = Math.max(0, Math.floor(options.extraTextureCount ?? 0));
        const targetFormat = options.targetFormat ?? "rgba8unorm";
        const program = device.createProgram({
            label: `postfx-${options.name}`,
            glsl: { vertex: FULLSCREEN_VERTEX_GLSL, fragment: options.fragment.glsl },
            wgsl: { code: FULLSCREEN_VERTEX_WGSL + options.fragment.wgsl },
        });
        const entries = [
            { binding: 0, type: "uniform-buffer", visibility: 2, name: "ParamsBlock" },
            {
                binding: 1,
                type: "texture",
                visibility: 2,
                name: "u_input",
                ...(options.textureSampleType === "depth" ? { sampleType: "depth" } : {}),
            },
            { binding: 2, type: "sampler", visibility: 2, name: "u_inputSampler" },
        ];
        for (let i = 0; i < this._extraCount; i++) {
            entries.push({ binding: 3 + i, type: "texture", visibility: 2, name: `u_extra${i}` });
        }
        this.layout = device.createBindGroupLayout({ label: `postfx-${options.name}-layout`, entries });
        this.params = new UniformBlock(device, {
            label: `postfx-${options.name}-params`,
            fields: [
                { name: "u_texelSize", type: "vec4" },
                { name: "u_params", type: "vec4" },
                { name: "u_params2", type: "vec4" },
            ],
        });
        this.sampler = device.createSampler({
            label: `postfx-${options.name}-sampler`,
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
            magFilter: options.nearest ? "nearest" : "linear",
            minFilter: options.nearest ? "nearest" : "linear",
            mips: false,
        });
        this.pipeline = device.createRenderPipeline({
            label: `postfx-${options.name}`,
            program,
            bindGroupLayouts: [this.layout],
            vertex: { buffers: [] },
            primitive: { topology: "triangle-list", cullMode: "none", frontFace: "ccw" },
            multisample: { count: Math.max(1, Math.floor(options.sampleCount ?? 1)) },
            depthStencil: null,
            targets: [
                {
                    format: targetFormat,
                    ...(options.blend ? { blend: options.blend === true ? OVER_BLEND : options.blend } : {}),
                },
            ],
        });
    }
    /** 设置自定义 uniform（`u_params` / `u_params2`） */
    setParams(a, b, c, d, e = 0, f = 0, g = 0, h = 0) {
        this.params.setVec4("u_params", a, b, c, d);
        this.params.setVec4("u_params2", e, f, g, h);
        return this;
    }
    /** 设置第 i 张额外纹理（`extraTextureCount > 0` 时有效） */
    setExtraTexture(index, texture) {
        this._extras[index] = texture;
        return this;
    }
    /** 由 composer 调用：把输入渲染到 `ctx.output`（自己开 pass，允许内部多趟） */
    render(ctx) {
        const pass = ctx.beginOutputPass(this.name);
        this.draw(pass, ctx.inputs[0], ctx.width, ctx.height);
        pass.end();
    }
    /** 手动使用（不经过 composer 时） */
    draw(pass, input, width, height) {
        this.params.setVec4("u_texelSize", width, height, 1 / Math.max(1, width), 1 / Math.max(1, height));
        this.params.flush();
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this._bindGroupFor(input));
        pass.draw(3);
    }
    dispose() {
        this._placeholder?.destroy();
        this._placeholder = null;
        this.params.buffer.destroy();
        this.sampler.destroy();
        this.pipeline.destroy();
    }
    _makePlaceholder() {
        const tex = this.device.createTexture({
            label: `postfx-${this.name}-placeholder`,
            width: 1,
            height: 1,
            format: "rgba8unorm",
            usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST,
        });
        tex.upload(new Uint8Array(textureFormatInfo("rgba8unorm").bytesPerTexel));
        this._placeholder = tex;
        return tex;
    }
    /**
     * 输入纹理 → bind group。
     *
     * **必须按纹理身份（对象）缓存，不能按 `label` 缓存**：同一个 pass 会被反复用于
     * 多张目标，而这些目标的 label 往往一样（render2d 的每一组阴影遮罩都叫
     * `2d-shadow-mask-color`）—— 按 label 缓存会让第 2 组拿到第 1 组的 bind group，
     * 于是「模糊/合成读的是上一组的遮罩」：阴影张冠李戴、甚至叠在别的图形上。
     */
    _bindGroups = new WeakMap();
    _bindGroupFor(input) {
        const extrasKey = this._extras.map((t) => (t ? t.label ?? "?" : "-")).join(",");
        const hit = this._bindGroups.get(input);
        if (hit && hit.extrasKey === extrasKey)
            return hit.group;
        const placeholder = this._placeholder ?? this._makePlaceholder();
        const entries = [
            { binding: 0, resource: this.params.buffer },
            { binding: 1, resource: input.view() },
            { binding: 2, resource: this.sampler },
        ];
        for (let i = 0; i < this._extraCount; i++) {
            entries.push({ binding: 3 + i, resource: (this._extras[i] ?? placeholder).view() });
        }
        const group = this.device.createBindGroup({ label: `postfx-${this.name}-group`, layout: this.layout, entries });
        this._bindGroups.set(input, { extrasKey, group });
        return group;
    }
}
const FULLSCREEN_VERTEX_GLSL = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  // 覆盖屏幕的大三角形：(-1,-1) (3,-1) (-1,3)
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;
const FULLSCREEN_VERTEX_WGSL = `
struct VSOut {
  @builtin(position) clip_pos : vec4f,
  @location(0) v_uv : vec2f,
};
@vertex
fn vs_main(@builtin(vertex_index) index : u32) -> VSOut {
  let p = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var out : VSOut;
  out.clip_pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  out.v_uv = p;
  return out;
}
`;
/** 各效果公用的 uniform 声明 + 输入采样（GLSL） */
export const POSTFX_COMMON_GLSL = `
layout(std140) uniform ParamsBlock {
  vec4 u_texelSize;   // xy = 尺寸, zw = 1/尺寸
  vec4 u_params;      // 效果自定义
  vec4 u_params2;
};
uniform sampler2D u_input;
in vec2 v_uv;
out vec4 fragColor;
`;
/** 各效果公用的 uniform 声明 + 输入采样（WGSL） */
export const POSTFX_COMMON_WGSL = `
struct ParamsBlock {
  u_texelSize : vec4f,
  u_params : vec4f,
  u_params2 : vec4f,
};
@group(0) @binding(0) var<uniform> fx : ParamsBlock;
@group(0) @binding(1) var u_input : texture_2d<f32>;
@group(0) @binding(2) var u_inputSampler : sampler;

struct FSIn {
  @builtin(position) clip_pos : vec4f,
  @location(0) v_uv : vec2f,
};
`;
//# sourceMappingURL=FullScreenPass.js.map