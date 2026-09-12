import { TextureFormat } from "../../../gpu/types.js";
export type GL = WebGL2RenderingContext;
export declare function compileShader(gl: GL, type: number, source: string): WebGLShader;
export declare function bufferTarget(usage: number): number;
export declare function bufferUsageHint(usage: number): number;
/** 纹理格式 → GL 常量（有类型的安全映射） */
export declare function textureGLParams(gl: GL, format: TextureFormat): {
    internal: number;
    format: number;
    type: number;
};
export declare function attributeGLType(gl: GL, glType: "FLOAT" | "UNSIGNED_BYTE" | "BYTE" | "UNSIGNED_SHORT" | "SHORT"): number;
export declare function describeRenderer(gl: GL): string;
//# sourceMappingURL=glUtils.d.ts.map