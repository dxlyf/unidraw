import type { Device } from "../device/Device.js";
import type { BindGroupLayoutEntryDescriptor, VertexStateDescriptor } from "../device/descriptors.js";
import type { TextureFormat } from "../gpu/types.js";
import type { UniformField } from "../gpu/std140.js";
import type { MaterialOptions } from "./BaseMaterial.js";
export declare const CAMERA_FIELDS: UniformField[];
export declare const MODEL_FIELDS: UniformField[];
/** u_color + u_params(x=shininess, y=spec 强度, z=ambient, w=保留) */
export declare const MATERIAL_FIELDS: UniformField[];
export declare const STANDARD_VERTEX_STATE: VertexStateDescriptor;
/**
 * 实例化顶点状态：标准顶点流 + `stepMode: "instance"` 的实例矩阵流（slot 1，stride 64）。
 *
 * 实例矩阵按列主序存 4 个 vec4（location 3..6），与 `InstancedMesh` 的实例缓冲一致。
 */
export declare const STANDARD_VERTEX_STATE_INSTANCED: VertexStateDescriptor;
/** 实例缓冲所在的顶点流序号（`InstancedMesh.instanceBuffer` 绑到这里） */
export declare const INSTANCE_VERTEX_SLOT = 1;
export declare const VS_FRAGMENT_VISIBILITY = 3;
export declare function defaultBlendState(): {
    color: {
        srcFactor: "src-alpha";
        dstFactor: "one-minus-src-alpha";
        operation: "add";
    };
    alpha: {
        srcFactor: "one";
        dstFactor: "one-minus-src-alpha";
        operation: "add";
    };
};
export declare function depthFormatOf(_device: Device, opts: MaterialOptions): TextureFormat;
export declare function targetFormatOf(device: Device, opts: MaterialOptions): TextureFormat;
/**
 * 标准 group 布局：0=相机 UBO、1=模型 UBO（动态偏移，逐物体换槽）、2=材质 UBO、
 * 3=灯光 UBO（`LightsBlock`）、**6=阴影 UBO（`ShadowBlock`）+ 7..10 阴影贴图 +
 * 11..14 阴影采样器**（binding 4/5 留给具体材质自己的纹理，见 `TextureMaterial`）。
 *
 * 阴影槽位对「不用阴影的材质」同样无害：声明的 binding 全部绑定，着色器没用到
 * 就不会产生额外开销（WebGL2 只多做几次纹理绑定）。
 *
 * `options.shadows === false` 时完全不声明阴影 binding：阴影贴图 pass 用的
 * 「只写深度」材质必须这样（WebGPU 禁止「同一次提交内既把某纹理作为附件写入、
 * 又作为只读纹理资源绑定」，即使是同一个 pass 也不行）。
 */
export declare function defaultGroupEntries(options?: {
    shadows?: boolean;
}): BindGroupLayoutEntryDescriptor[];
//# sourceMappingURL=materialCommon.d.ts.map