import { BaseMaterial } from "../render/BaseMaterial.js";
import { UniformBlock } from "../render/UniformBlock.js";
export const ID_FIELDS = [{ name: "u_id", type: "vec4" }];
/** 物体编号 → ID 颜色（0..255 分量，按 R/G/B 低位到高位编码）。 */
export function encodeId(id) {
    return [id & 0xff, (id >> 8) & 0xff, (id >> 16) & 0xff];
}
/** ID 颜色 → 物体编号（`encodeId` 的逆运算）。 */
export function decodeId(r, g, b) {
    return (r & 0xff) | ((g & 0xff) << 8) | ((b & 0xff) << 16);
}
/**
 * 拾取用 ID 材质：把「物体编号」编码成颜色直接写入离屏目标。
 *
 * - 每个物体在 ID pass 里占一个「动态偏移槽」写入自己的 ID（binding 3），
 *   因此**一个材质实例**就能绘制全部物体（不需要每物体一个材质/UBO/管线）；
 * - 相机/模型使用与其它材质相同的标准布局（binding 0/1），
 *   所以深度测试、剔除行为与正式渲染完全一致。
 */
export class IdMaterial extends BaseMaterial {
    /** ID 环形块与模型矩阵环形块保持同容量 */
    _idBlock;
    _idSlotCount;
    _idColor = [0, 0, 0];
    _id = 0;
    /** 逐 draw 复用的动态偏移数组 */
    _extraOffsets = [0];
    constructor(device, opts = {}) {
        super(device, device.createProgram({
            label: `${opts.label ?? "id"}-program`,
            glsl: { vertex: ID_VERTEX_GLSL, fragment: ID_FRAGMENT_GLSL },
            wgsl: { code: ID_WGSL },
        }), { ...opts, label: opts.label ?? "unidraw-id-material", instancedVertex: ID_INSTANCED_VERTEX }, [{ binding: 4, type: "uniform-buffer", visibility: 1, name: "IdBlock", hasDynamicOffset: true }]);
        this._idSlotCount = this.modelSlotCount;
        this._idBlock = new UniformBlock(device, {
            label: `${opts.label ?? "id"}-id-block`,
            fields: ID_FIELDS,
            slots: this._idSlotCount,
        });
        // ID 是逐 draw 写入的 → 必须注册进「提交前合批上传」，否则 GPU 上恒为 0（拾取全 miss）
        this.registerFlushBlock(this._idBlock);
        this.assembleBindGroup();
    }
    /** 当前物体编号（0 = 背景/未使用） */
    get id() {
        return this._id;
    }
    /** 设置下一个绘制的物体编号（1 起；0 保留给背景）。 */
    setId(id) {
        const value = Math.max(0, Math.floor(id));
        this._id = value;
        this._idColor = encodeId(value);
        return this;
    }
    /** 直接设置 ID 颜色（0..1，调试用）。 */
    setIdColor(color) {
        this._idColor = [Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255)];
        return this;
    }
    createBindGroup() {
        const entries = [
            ...this.baseBindGroupEntries(),
            { binding: 4, resource: this._idBlock.buffer, offset: 0, size: this._idBlock.stride },
        ];
        return this.device.createBindGroup({ label: "id-material-group", layout: this.layout, entries });
    }
    extraDynamicOffsets(slot) {
        if (slot >= this._idSlotCount)
            this.growIdRing(slot + 1);
        const [r, g, b] = this._idColor;
        this._idBlock.setVec4("u_id", r / 255, g / 255, b / 255, 1);
        this._idBlock.flushSlot(slot);
        // 复用数组：逐 draw 分配会让 GPU 颜色拾取（每帧全场景一次）产生大量短命数组
        this._extraOffsets[0] = slot * this._idBlock.stride;
        return this._extraOffsets;
    }
    growIdRing(needed) {
        const slots = Math.max(needed, this._idSlotCount * 2);
        this._idBlock = new UniformBlock(this.device, { label: `id-block-${slots}`, fields: ID_FIELDS, slots });
        this._idSlotCount = slots;
        this.registerFlushBlock(this._idBlock);
        this.assembleBindGroup();
    }
}
const ID_VERTEX_GLSL = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;

layout(std140) uniform CameraBlock {
  mat4 u_viewProj;
  vec4 u_cameraPos;
};
layout(std140) uniform ModelBlock {
  mat4 u_model;
};
layout(std140) uniform IdBlock {
  vec4 u_id;
};

out vec4 v_id;

void main() {
  v_id = u_id;
  gl_Position = u_viewProj * u_model * vec4(a_position, 1.0);
}
`;
const ID_FRAGMENT_GLSL = `#version 300 es
precision highp float;
in vec4 v_id;
out vec4 fragColor;
void main() { fragColor = v_id; }
`;
const ID_WGSL = `
struct CameraBlock {
  u_viewProj : mat4x4f,
  u_cameraPos : vec4f,
};
struct ModelBlock {
  u_model : mat4x4f,
};
struct IdBlock {
  u_id : vec4f,
};

@group(0) @binding(0) var<uniform> camera : CameraBlock;
@group(0) @binding(1) var<uniform> model : ModelBlock;
@group(0) @binding(4) var<uniform> idBlock : IdBlock;

struct VSOut {
  @builtin(position) clip_pos : vec4f,
  @location(0) v_id : vec4f,
};

@vertex
fn vs_main(@location(0) a_position : vec3f, @location(1) a_normal : vec3f, @location(2) a_uv : vec2f) -> VSOut {
  var out : VSOut;
  out.clip_pos = camera.u_viewProj * model.u_model * vec4f(a_position, 1.0);
  out.v_id = idBlock.u_id;
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4f {
  return in.v_id;
}
`;
/** GLSL：ID 材质的实例化顶点着色器（ID 逐 draw 写入，所有实例共享同一个 ID） */
const ID_INSTANCED_VERTEX = {
    glsl: `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in vec4 a_instance0;
layout(location = 4) in vec4 a_instance1;
layout(location = 5) in vec4 a_instance2;
layout(location = 6) in vec4 a_instance3;

layout(std140) uniform CameraBlock {
  mat4 u_viewProj;
  vec4 u_cameraPos;
};
layout(std140) uniform ModelBlock {
  mat4 u_model;
};
layout(std140) uniform IdBlock {
  vec4 u_id;
};

out vec4 v_id;

void main() {
  mat4 instance = mat4(a_instance0, a_instance1, a_instance2, a_instance3);
  v_id = u_id;
  gl_Position = u_viewProj * u_model * instance * vec4(a_position, 1.0);
}
`,
    wgsl: `
struct CameraBlock {
  u_viewProj : mat4x4f,
  u_cameraPos : vec4f,
};
struct ModelBlock {
  u_model : mat4x4f,
};
struct IdBlock {
  u_id : vec4f,
};

@group(0) @binding(0) var<uniform> camera : CameraBlock;
@group(0) @binding(1) var<uniform> model : ModelBlock;
@group(0) @binding(4) var<uniform> idBlock : IdBlock;

struct VSOut {
  @builtin(position) clip_pos : vec4f,
  @location(0) v_id : vec4f,
};

@vertex
fn vs_main(
  @location(0) a_position : vec3f,
  @location(1) a_normal : vec3f,
  @location(2) a_uv : vec2f,
  @location(3) a_instance0 : vec4f,
  @location(4) a_instance1 : vec4f,
  @location(5) a_instance2 : vec4f,
  @location(6) a_instance3 : vec4f,
) -> VSOut {
  var out : VSOut;
  let instance = mat4x4f(a_instance0, a_instance1, a_instance2, a_instance3);
  out.clip_pos = camera.u_viewProj * model.u_model * instance * vec4f(a_position, 1.0);
  out.v_id = idBlock.u_id;
  return out;
}
`,
};
//# sourceMappingURL=IdMaterial.js.map