/**
 * 内置后处理效果。
 *
 * | 效果 | 作用 | 关键参数 |
 * | --- | --- | --- |
 * | `CopyPass` | 直通拷贝（也用于「无效果时输出」） | — |
 * | `ToneMapPass` | 色调映射 + 曝光（none/linear/reinhard/aces） | `mode`、`exposure` |
 * | `VignettePass` | 暗角 | `strength`、`softness` |
 * | `GrayscalePass` | 灰度（含配方权重） | `amount` |
 * | `BloomPass` | 亮部提取 + 可分离高斯模糊 + 叠加（自带中间目标） | `threshold`、`strength`、`radius`、`scale` |
 * | `ShaderPass` | 自定义 fragment（GLSL + WGSL 成对给出） | 自定义 |
 *
 * 多趟效果（Bloom）自带 `RenderTarget`，通过 `ctx.encoder` 自己开 pass，
 * 因此可以任意嵌套/组合，不需要 composer 特殊照顾。
 */
import { FullScreenPass, POSTFX_COMMON_GLSL, POSTFX_COMMON_WGSL } from "./FullScreenPass.js";
import { RenderTarget } from "../RenderTarget.js";
// ---------------------------------------------------------------------------
// 单趟效果
// ---------------------------------------------------------------------------
/** 直通拷贝（可用于「把某张纹理输出到画布/目标」） */
export class CopyPass extends FullScreenPass {
    constructor(device, targetFormat) {
        super(device, { name: "copy", fragment: { glsl: COPY_GLSL, wgsl: COPY_WGSL }, targetFormat });
    }
}
/** 色调映射：HDR → LDR（默认 ACES 电影级曲线） */
export class ToneMapPass extends FullScreenPass {
    mode;
    exposure;
    constructor(device, options = {}) {
        super(device, { name: "tonemap", fragment: { glsl: TONEMAP_GLSL, wgsl: TONEMAP_WGSL }, targetFormat: options.targetFormat });
        this.mode = options.mode ?? "aces";
        this.exposure = options.exposure ?? 1;
    }
    render(ctx) {
        this.setParams(this.exposure, modeCode(this.mode), 0, 0);
        super.render(ctx);
    }
}
export class VignettePass extends FullScreenPass {
    /** 暗角强度（0 关闭） */
    strength;
    /** 软化程度（越大越平滑） */
    softness;
    constructor(device, options = {}) {
        super(device, { name: "vignette", fragment: { glsl: VIGNETTE_GLSL, wgsl: VIGNETTE_WGSL }, targetFormat: options.targetFormat });
        this.strength = options.strength ?? 0.45;
        this.softness = options.softness ?? 0.65;
    }
    render(ctx) {
        this.setParams(this.strength, this.softness, 0, 0);
        super.render(ctx);
    }
}
export class GrayscalePass extends FullScreenPass {
    /** 混合量 0..1 */
    amount;
    constructor(device, options = {}) {
        super(device, { name: "grayscale", fragment: { glsl: GRAYSCALE_GLSL, wgsl: GRAYSCALE_WGSL }, targetFormat: options.targetFormat });
        this.amount = options.amount ?? 1;
    }
    render(ctx) {
        this.setParams(this.amount, 0, 0, 0);
        super.render(ctx);
    }
}
/** 自定义单趟效果 */
export class ShaderPass extends FullScreenPass {
    constructor(device, options) {
        super(device, {
            name: options.name ?? "shader",
            fragment: options.fragment,
            targetFormat: options.targetFormat,
            extraTextureCount: options.extraTextureCount,
        });
    }
}
export class BloomPass {
    name = "bloom";
    threshold;
    strength;
    radius;
    _device;
    _bright;
    _blur;
    _composite;
    _scale;
    _format;
    _half = null;
    _tmp = null;
    _width = 0;
    _height = 0;
    constructor(device, options = {}) {
        this._device = device;
        this.threshold = options.threshold ?? 0.75;
        this.strength = options.strength ?? 0.9;
        this.radius = options.radius ?? 2;
        this._scale = Math.max(0.1, Math.min(1, options.scale ?? 0.5));
        this._format = options.targetFormat ?? "rgba8unorm";
        this._bright = new FullScreenPass(device, {
            name: "bloom-bright",
            fragment: { glsl: BLOOM_BRIGHT_GLSL, wgsl: BLOOM_BRIGHT_WGSL },
            targetFormat: this._format,
        });
        this._blur = new FullScreenPass(device, {
            name: "bloom-blur",
            fragment: { glsl: BLOOM_BLUR_GLSL, wgsl: BLOOM_BLUR_WGSL },
            targetFormat: this._format,
        });
        this._composite = new FullScreenPass(device, {
            name: "bloom-composite",
            fragment: { glsl: BLOOM_COMPOSITE_GLSL, wgsl: BLOOM_COMPOSITE_WGSL },
            targetFormat: this._format,
            extraTextureCount: 1,
        });
    }
    resize(width, height) {
        this._width = width;
        this._height = height;
        const w = Math.max(1, Math.floor(width * this._scale));
        const h = Math.max(1, Math.floor(height * this._scale));
        if (!this._half || !this._tmp) {
            this._half = new RenderTarget(this._device, { width: w, height: h, format: this._format, depth: false, label: "bloom-half" });
            this._tmp = new RenderTarget(this._device, { width: w, height: h, format: this._format, depth: false, label: "bloom-tmp" });
        }
        else {
            this._half.resize(w, h);
            this._tmp.resize(w, h);
        }
    }
    render(ctx) {
        if (!this._half || !this._tmp)
            this.resize(ctx.width, ctx.height);
        const half = this._half;
        const tmp = this._tmp;
        // 1) 亮部提取 → half
        this._renderTo(ctx, this._bright, ctx.inputs[0], half, () => this._bright.setParams(this.threshold, 0, 0, 0));
        // 2) 横向模糊 half → tmp
        this._renderTo(ctx, this._blur, half.texture, tmp, () => this._blur.setParams(this.radius, 1, 0, 0));
        // 3) 纵向模糊 tmp → half
        this._renderTo(ctx, this._blur, tmp.texture, half, () => this._blur.setParams(this.radius, 0, 0, 0));
        // 4) 叠加：原图 + 泛光 → 输出
        this._composite.setExtraTexture(0, half.texture);
        this._composite.setParams(this.strength, 0, 0, 0);
        const pass = ctx.beginOutputPass("bloom-composite");
        this._composite.draw(pass, ctx.inputs[0], ctx.width, ctx.height);
        pass.end();
    }
    dispose() {
        this._bright.dispose();
        this._blur.dispose();
        this._composite.dispose();
        this._half?.dispose();
        this._tmp?.dispose();
        this._half = null;
        this._tmp = null;
    }
    _renderTo(ctx, fx, input, target, configure) {
        configure();
        const pass = ctx.encoder.beginRenderPass({
            label: `bloom-${fx.name}`,
            colorAttachments: [target.colorAttachment()],
            depthStencilAttachment: null,
        });
        fx.draw(pass, input, this._width, this._height);
        pass.end();
    }
}
function modeCode(mode) {
    return mode === "none" ? 0 : mode === "linear" ? 1 : mode === "reinhard" ? 2 : 3;
}
// ---------------------------------------------------------------------------
// shader 源码
// ---------------------------------------------------------------------------
const COPY_GLSL = `#version 300 es
precision highp float;
${POSTFX_COMMON_GLSL}
void main() { fragColor = texture(u_input, v_uv); }
`;
const COPY_WGSL = `
${POSTFX_COMMON_WGSL}
@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  return textureSample(u_input, u_inputSampler, in.v_uv);
}
`;
const TONEMAP_GLSL = `#version 300 es
precision highp float;
${POSTFX_COMMON_GLSL}
// u_params: x=曝光, y=模式(0 none / 1 linear / 2 reinhard / 3 aces)

vec3 acesFilm(vec3 x) {
  float a = 2.51; float b = 0.03; float c = 2.43; float d = 0.59; float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec3 color = texture(u_input, v_uv).rgb * max(u_params.x, 0.0);
  int mode = int(u_params.y + 0.5);
  if (mode == 1) color = clamp(color, 0.0, 1.0);
  else if (mode == 2) color = color / (color + vec3(1.0));
  else if (mode == 3) color = acesFilm(color);
  fragColor = vec4(color, 1.0);
}
`;
const TONEMAP_WGSL = `
${POSTFX_COMMON_WGSL}
fn acesFilm(x : vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  var color = textureSample(u_input, u_inputSampler, in.v_uv).rgb * max(fx.u_params.x, 0.0);
  let mode = i32(fx.u_params.y + 0.5);
  if (mode == 1) { color = clamp(color, vec3f(0.0), vec3f(1.0)); }
  else if (mode == 2) { color = color / (color + vec3f(1.0)); }
  else if (mode == 3) { color = acesFilm(color); }
  return vec4f(color, 1.0);
}
`;
const VIGNETTE_GLSL = `#version 300 es
precision highp float;
${POSTFX_COMMON_GLSL}
// u_params: x=强度, y=软化
void main() {
  vec4 src = texture(u_input, v_uv);
  vec2 d = (v_uv - 0.5) * 2.0;
  float r = length(d) * 0.75;
  float v = smoothstep(1.0, max(1.0 - u_params.y, 0.01), r);
  float k = mix(1.0, v, clamp(u_params.x, 0.0, 1.0));
  fragColor = vec4(src.rgb * k, src.a);
}
`;
const VIGNETTE_WGSL = `
${POSTFX_COMMON_WGSL}
@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  let src = textureSample(u_input, u_inputSampler, in.v_uv);
  let d = (in.v_uv - vec2f(0.5)) * 2.0;
  let r = length(d) * 0.75;
  let v = smoothstep(1.0, max(1.0 - fx.u_params.y, 0.01), r);
  let k = mix(1.0, v, clamp(fx.u_params.x, 0.0, 1.0));
  return vec4f(src.rgb * k, src.a);
}
`;
const GRAYSCALE_GLSL = `#version 300 es
precision highp float;
${POSTFX_COMMON_GLSL}
void main() {
  vec3 c = texture(u_input, v_uv).rgb;
  float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
  fragColor = vec4(mix(c, vec3(g), clamp(u_params.x, 0.0, 1.0)), 1.0);
}
`;
const GRAYSCALE_WGSL = `
${POSTFX_COMMON_WGSL}
@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  let c = textureSample(u_input, u_inputSampler, in.v_uv).rgb;
  let g = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  return vec4f(mix(c, vec3f(g), clamp(fx.u_params.x, 0.0, 1.0)), 1.0);
}
`;
const BLOOM_BRIGHT_GLSL = `#version 300 es
precision highp float;
${POSTFX_COMMON_GLSL}
// u_params.x = 阈值
void main() {
  vec3 c = texture(u_input, v_uv).rgb;
  float l = max(max(c.r, c.g), c.b);
  float k = max(l - u_params.x, 0.0) / max(l, 1e-4);
  fragColor = vec4(c * k, 1.0);
}
`;
const BLOOM_BRIGHT_WGSL = `
${POSTFX_COMMON_WGSL}
@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  let c = textureSample(u_input, u_inputSampler, in.v_uv).rgb;
  let l = max(max(c.r, c.g), c.b);
  let k = max(l - fx.u_params.x, 0.0) / max(l, 1e-4);
  return vec4f(c * k, 1.0);
}
`;
const BLOOM_BLUR_GLSL = `#version 300 es
precision highp float;
${POSTFX_COMMON_GLSL}
// u_params.x = 半径, u_params.y = 1 横向 / 0 纵向
void main() {
  vec2 dir = u_params.y > 0.5 ? vec2(u_texelSize.z, 0.0) : vec2(0.0, u_texelSize.w);
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = -4; i <= 4; i++) {
    float w = exp(-float(i * i) / 8.0);
    sum += texture(u_input, v_uv + dir * float(i) * u_params.x).rgb * w;
    total += w;
  }
  fragColor = vec4(sum / total, 1.0);
}
`;
const BLOOM_BLUR_WGSL = `
${POSTFX_COMMON_WGSL}
@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  var dir = vec2f(0.0, fx.u_texelSize.w);
  if (fx.u_params.y > 0.5) { dir = vec2f(fx.u_texelSize.z, 0.0); }
  var sum = vec3f(0.0);
  var total = 0.0;
  for (var i = -4; i <= 4; i = i + 1) {
    let w = exp(-f32(i * i) / 8.0);
    sum = sum + textureSample(u_input, u_inputSampler, in.v_uv + dir * f32(i) * fx.u_params.x).rgb * w;
    total = total + w;
  }
  return vec4f(sum / total, 1.0);
}
`;
const BLOOM_COMPOSITE_GLSL = `#version 300 es
precision highp float;
${POSTFX_COMMON_GLSL}
uniform sampler2D u_extra0;   // 泛光图
// u_params.x = 强度
void main() {
  vec3 base = texture(u_input, v_uv).rgb;
  vec3 bloom = texture(u_extra0, v_uv).rgb;
  fragColor = vec4(base + bloom * u_params.x, 1.0);
}
`;
const BLOOM_COMPOSITE_WGSL = `
${POSTFX_COMMON_WGSL}
@group(0) @binding(3) var u_extra0 : texture_2d<f32>;

@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  let base = textureSample(u_input, u_inputSampler, in.v_uv).rgb;
  let bloom = textureSample(u_extra0, u_inputSampler, in.v_uv).rgb;
  return vec4f(base + bloom * fx.u_params.x, 1.0);
}
`;
//# sourceMappingURL=effects.js.map