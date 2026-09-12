export declare class Vec4 {
    x: number;
    y: number;
    z: number;
    w: number;
    constructor(x?: number, y?: number, z?: number, w?: number);
    static zero(): Vec4;
    set(x: number, y: number, z: number, w: number): this;
    copy(v: Vec4): this;
    clone(): Vec4;
    add(v: Vec4): this;
    scale(s: number): this;
    lengthSq(): number;
    length(): number;
    equals(v: Vec4, epsilon?: number): boolean;
    /** 连续写入 Float32Array（用于 uniform/顶点上传）。 */
    writeTo(out: Float32Array, byteOffset?: number): void;
    toString(): string;
}
export declare function vec4Dot(a: Vec4, b: Vec4): number;
//# sourceMappingURL=vec4.d.ts.map