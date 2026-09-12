/**
 * `globalCompositeOperation` 里**必须以目标为输入**的那 11 种混合模式。
 *
 * 为什么单独一个 pass：`overlay / color-dodge / color-burn / hard-light / soft-light /
 * difference / exclusion / hue / saturation / color / luminosity` 的 `B(Cb, Cs)` 不能
 * 写成固定的混合因子 —— 目标颜色得当成纹理读进来。所以 render2d 在这种 op 出现时
 * 切到「图层模式」：
 *
 *   ① 本帧此前的绘制都落在一张图层纹理上（`dst`，绑定在 binding 1）；
 *   ② 该 op 的几何单独画进一张透明底的源图层（`src`，绑定在 binding 3）；
 *   ③ 本 pass 读 (dst, src) 按公式算出最终颜色，**关掉混合**整块写出；
 *   ④ 后续 op 继续画在这张新图层上（ping-pong）。
 *
 * 公式按 W3C Compositing and Blending Level 1。输入输出都按**直通 alpha**处理：
 * 图层里存的 rgb 其实是预乘的，所以先把两边都除以自己的 alpha 还原成直通颜色，
 * 算完再按 `αs` 与 `αb` 合成回预乘结果（这样和固定管线那条路径的存储约定一致）。
 *
 * 混合模式在源覆盖率为 0 的地方必须**保持目标不变**（`αs = 0` 时下面公式自然退化成
 * 恒等），所以不需要 `clearsOutside` 的补集四边形。
 */
import { FullScreenPass, POSTFX_COMMON_GLSL, POSTFX_COMMON_WGSL } from "../render/postfx/FullScreenPass.js";
/** 图层呈现用的**预乘 over**：图层 rgb 已经是预乘的，用直通因子会乘两次 alpha */
export const PREMULTIPLIED_OVER = {
    color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};
/** 模式名 → 着色器里的分支编号（顺序即 `DST_TEXTURE_BLEND_MODES` 的下标） */
export const DST_TEXTURE_BLEND_MODES = [
    "overlay",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
    "hue",
    "saturation",
    "color",
    "luminosity",
];
/**
 * 模式名 → 分支编号的查表。
 *
 * 用 `Map` 而不是 `indexOf`：这个查询在 `flush()` 里**逐 op** 调用，
 * 每个 op 都扫一遍数组纯属白花。
 */
const DST_TEXTURE_BLEND_INDEX = new Map(DST_TEXTURE_BLEND_MODES.map((m, i) => [m, i]));
/** 该合成模式是否要靠「目标当纹理」的着色器实现（是则返回分支编号，否则 -1） */
export function dstTextureBlendIndex(operation) {
    return DST_TEXTURE_BLEND_INDEX.get(operation) ?? -1;
}
export class BlendModePass extends FullScreenPass {
    constructor(device, targetFormat, sampleCount = 1) {
        super(device, {
            name: "2d-blend-mode",
            fragment: { glsl: BLEND_GLSL, wgsl: BLEND_WGSL },
            targetFormat,
            // src 图层走 binding 3（`FullScreenPass` 的额外纹理位）
            extraTextureCount: 1,
            sampleCount,
        });
    }
    /**
     * `dst` 是本帧此前的图层，`src` 是这个 op 自己的图层；结果写进 `pass`。
     *
     * `flipY` 与阴影合成同一套道理：采样的是几何渲染出来的纹理，WebGPU 的行序反过来。
     */
    drawBlend(pass, dst, src, width, height, modeIndex, flipY) {
        this.setExtraTexture(0, src);
        this.setParams(modeIndex, flipY ? 1 : 0, 0, 0);
        this.draw(pass, dst, width, height);
    }
}
/** 图层绘制 + 呈现（渲染2d 的「图层模式」用） */
export class LayerPass extends FullScreenPass {
    constructor(device, targetFormat, sampleCount = 1, blend) {
        super(device, {
            name: "2d-layer-present",
            fragment: { glsl: LAYER_GLSL, wgsl: LAYER_WGSL },
            targetFormat,
            sampleCount,
            blend,
        });
    }
    /** 把图层纹理呈现到调用方的 pass（可选翻转） */
    drawLayer(pass, layer, width, height, flipY) {
        this.setParams(flipY ? 1 : 0, 0, 0, 0);
        this.draw(pass, layer, width, height);
    }
}
const BLEND_COMMON_GLSL = `
${POSTFX_COMMON_GLSL}
uniform sampler2D u_extra0;   // src 图层
`;
const BLEND_COMMON_WGSL = `
${POSTFX_COMMON_WGSL}
@group(0) @binding(3) var u_extra0 : texture_2d<f32>;
`;
/** 可分离混合模式 + 非可分离模式的公共函数（GLSL） */
const BLEND_FUNCS_GLSL = `
float bmul(float cb, float cs) { return cb * cs; }
float bscreen(float cb, float cs) { return cb + cs - cb * cs; }
float bhardLight(float cb, float cs) {
  return cs <= 0.5 ? bmul(cb, 2.0 * cs) : bscreen(cb, 2.0 * cs - 1.0);
}
float bsoftLight(float cb, float cs) {
  float d = cb <= 0.25 ? ((16.0 * cb - 12.0) * cb + 4.0) * cb : sqrt(cb);
  return cs <= 0.5 ? cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb) : cb + (2.0 * cs - 1.0) * (d - cb);
}
float blum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 bclip(vec3 c) {
  float l = blum(c);
  float n = min(min(c.r, c.g), c.b);
  float x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + (c - l) * l / (l - n);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / (x - l);
  return c;
}
vec3 bsetLum(vec3 c, float l) { return bclip(c + (l - blum(c))); }
float bsat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }
vec3 bsetSat(vec3 c, float s) {
  float mn = min(min(c.r, c.g), c.b);
  float mx = max(max(c.r, c.g), c.b);
  float md = c.r + c.g + c.b - mn - mx;
  if (mx > mn) md = (md - mn) * s / (mx - mn);
  else md = 0.0;
  return vec3(c.r == mn ? 0.0 : (c.r == mx ? s : md), c.g == mn ? 0.0 : (c.g == mx ? s : md), c.b == mn ? 0.0 : (c.b == mx ? s : md));
}
vec3 bseparable(int m, vec3 cb, vec3 cs) {
  if (m == 0) return vec3(bhardLight(cs.r, cb.r), bhardLight(cs.g, cb.g), bhardLight(cs.b, cb.b)); // overlay
  if (m == 1) return vec3(cb.r == 0.0 ? 0.0 : (cs.r == 1.0 ? 1.0 : min(1.0, cb.r / (1.0 - cs.r))),
                          cb.g == 0.0 ? 0.0 : (cs.g == 1.0 ? 1.0 : min(1.0, cb.g / (1.0 - cs.g))),
                          cb.b == 0.0 ? 0.0 : (cs.b == 1.0 ? 1.0 : min(1.0, cb.b / (1.0 - cs.b))));
  if (m == 2) return vec3(cb.r == 1.0 ? 1.0 : (cs.r == 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - cb.r) / cs.r)),
                          cb.g == 1.0 ? 1.0 : (cs.g == 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - cb.g) / cs.g)),
                          cb.b == 1.0 ? 1.0 : (cs.b == 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - cb.b) / cs.b)));
  if (m == 3) return vec3(bhardLight(cb.r, cs.r), bhardLight(cb.g, cs.g), bhardLight(cb.b, cs.b));
  if (m == 4) return vec3(bsoftLight(cb.r, cs.r), bsoftLight(cb.g, cs.g), bsoftLight(cb.b, cs.b));
  if (m == 5) return abs(cb - cs);
  return cb + cs - 2.0 * cb * cs;                    // exclusion
}
vec3 bnonSeparable(int m, vec3 cb, vec3 cs) {
  if (m == 7) return bsetLum(bsetSat(cs, bsat(cb)), blum(cb));   // hue
  if (m == 8) return bsetLum(bsetSat(cb, bsat(cs)), blum(cb));   // saturation
  if (m == 9) return bsetLum(cs, blum(cb));                      // color
  return bsetLum(cb, blum(cs));                                  // luminosity
}
/** 还原成直通颜色（图层里 rgb 是预乘的） */
vec3 bstraight(vec4 c) { return c.a > 0.0 ? c.rgb / c.a : vec3(0.0); }
`;
const BLEND_GLSL = `#version 300 es
precision highp float;
${BLEND_COMMON_GLSL}
${BLEND_FUNCS_GLSL}
void main() {
  vec2 uv = v_uv;
  if (u_params.y > 0.5) uv.y = 1.0 - uv.y;
  vec4 d = texture(u_input, uv);
  vec4 s = texture(u_extra0, uv);
  float ab = d.a;
  float as = s.a;
  vec3 cb = bstraight(d);
  vec3 cs = bstraight(s);
  // W3C：Cs' = (1 - αb)·Cs + αb·B(Cb, Cs)；再按 source-over 合成
  int m = int(u_params.x + 0.5);
  vec3 b = m >= 7 ? bnonSeparable(m, cb, cs) : bseparable(m, cb, cs);
  vec3 cse = mix(cs, b, ab);
  vec3 outPremul = as * cse + (1.0 - as) * d.rgb;
  float ao = as + ab * (1.0 - as);
  fragColor = vec4(outPremul, ao);
}
`;
const BLEND_FUNCS_WGSL = `
fn bmul(cb : f32, cs : f32) -> f32 { return cb * cs; }
fn bscreen(cb : f32, cs : f32) -> f32 { return cb + cs - cb * cs; }
fn bhardLight(cb : f32, cs : f32) -> f32 {
  return select(bscreen(cb, 2.0 * cs - 1.0), bmul(cb, 2.0 * cs), cs <= 0.5);
}
fn bsoftLight(cb : f32, cs : f32) -> f32 {
  var d = sqrt(cb);
  if (cb <= 0.25) { d = ((16.0 * cb - 12.0) * cb + 4.0) * cb; }
  return select(cb + (2.0 * cs - 1.0) * (d - cb), cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb), cs <= 0.5);
}
fn blum(c : vec3f) -> f32 { return dot(c, vec3f(0.3, 0.59, 0.11)); }
fn bclip(c0 : vec3f) -> vec3f {
  var c = c0;
  let l = blum(c);
  let n = min(min(c.r, c.g), c.b);
  let x = max(max(c.r, c.g), c.b);
  if (n < 0.0) { c = vec3f(l) + (c - vec3f(l)) * l / (l - n); }
  if (x > 1.0) { c = vec3f(l) + (c - vec3f(l)) * (1.0 - l) / (x - l); }
  return c;
}
fn bsetLum(c : vec3f, l : f32) -> vec3f { return bclip(c + vec3f(l - blum(c))); }
fn bsat(c : vec3f) -> f32 { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }
fn bsetSat(c : vec3f, s : f32) -> vec3f {
  let mn = min(min(c.r, c.g), c.b);
  let mx = max(max(c.r, c.g), c.b);
  var md = c.r + c.g + c.b - mn - mx;
  if (mx > mn) { md = (md - mn) * s / (mx - mn); } else { md = 0.0; }
  return vec3f(
    select(select(md, s, c.r == mx), 0.0, c.r == mn),
    select(select(md, s, c.g == mx), 0.0, c.g == mn),
    select(select(md, s, c.b == mx), 0.0, c.b == mn));
}
fn bseparable(m : i32, cb : vec3f, cs : vec3f) -> vec3f {
  if (m == 0) { return vec3f(bhardLight(cs.r, cb.r), bhardLight(cs.g, cb.g), bhardLight(cs.b, cb.b)); }
  if (m == 1) {
    return vec3f(
      select(select(min(1.0, cb.r / (1.0 - cs.r)), 1.0, cs.r == 1.0), 0.0, cb.r == 0.0),
      select(select(min(1.0, cb.g / (1.0 - cs.g)), 1.0, cs.g == 1.0), 0.0, cb.g == 0.0),
      select(select(min(1.0, cb.b / (1.0 - cs.b)), 1.0, cs.b == 1.0), 0.0, cb.b == 0.0));
  }
  if (m == 2) {
    return vec3f(
      select(select(1.0 - min(1.0, (1.0 - cb.r) / cs.r), 0.0, cs.r == 0.0), 1.0, cb.r == 1.0),
      select(select(1.0 - min(1.0, (1.0 - cb.g) / cs.g), 0.0, cs.g == 0.0), 1.0, cb.g == 1.0),
      select(select(1.0 - min(1.0, (1.0 - cb.b) / cs.b), 0.0, cs.b == 0.0), 1.0, cb.b == 1.0));
  }
  if (m == 3) { return vec3f(bhardLight(cb.r, cs.r), bhardLight(cb.g, cs.g), bhardLight(cb.b, cs.b)); }
  if (m == 4) { return vec3f(bsoftLight(cb.r, cs.r), bsoftLight(cb.g, cs.g), bsoftLight(cb.b, cs.b)); }
  if (m == 5) { return abs(cb - cs); }
  return cb + cs - 2.0 * cb * cs;
}
fn bnonSeparable(m : i32, cb : vec3f, cs : vec3f) -> vec3f {
  if (m == 7) { return bsetLum(bsetSat(cs, bsat(cb)), blum(cb)); }
  if (m == 8) { return bsetLum(bsetSat(cb, bsat(cs)), blum(cb)); }
  if (m == 9) { return bsetLum(cs, blum(cb)); }
  return bsetLum(cb, blum(cs));
}
fn bstraight(c : vec4f) -> vec3f {
  if (c.a > 0.0) { return c.rgb / c.a; }
  return vec3f(0.0);
}
`;
const BLEND_WGSL = `
${BLEND_COMMON_WGSL}
${BLEND_FUNCS_WGSL}
@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  var uv = in.v_uv;
  if (fx.u_params.y > 0.5) { uv.y = 1.0 - uv.y; }
  let d = textureSample(u_input, u_inputSampler, uv);
  let s = textureSample(u_extra0, u_inputSampler, uv);
  // 注意：「as」是 WGSL 保留字，这里只能用 alphaB / alphaS
  let alphaB = d.a;
  let alphaS = s.a;
  let cb = bstraight(d);
  let cs = bstraight(s);
  let m = i32(fx.u_params.x + 0.5);
  var b = bnonSeparable(m, cb, cs);
  if (m < 7) { b = bseparable(m, cb, cs); }
  let cse = mix(cs, b, vec3f(alphaB));
  let outPremul = alphaS * cse + (1.0 - alphaS) * d.rgb;
  let ao = alphaS + alphaB * (1.0 - alphaS);
  return vec4f(outPremul, ao);
}
`;
const LAYER_GLSL = `#version 300 es
precision highp float;
${POSTFX_COMMON_GLSL}
void main() {
  vec2 uv = v_uv;
  if (u_params.x > 0.5) uv.y = 1.0 - uv.y;
  fragColor = texture(u_input, uv);
}
`;
const LAYER_WGSL = `
${POSTFX_COMMON_WGSL}
@fragment
fn fs_main(in : FSIn) -> @location(0) vec4f {
  var uv = in.v_uv;
  if (fx.u_params.x > 0.5) { uv.y = 1.0 - uv.y; }
  return textureSample(u_input, u_inputSampler, uv);
}
`;
//# sourceMappingURL=blendPass.js.map