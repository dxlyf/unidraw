export declare class Vec2 {
    x: number;
    y: number;
    constructor(x?: number, y?: number);
    static zero(): Vec2;
    static one(): Vec2;
    set(x: number, y: number): this;
    copy(v: Vec2): this;
    clone(): Vec2;
    add(v: Vec2): this;
    sub(v: Vec2): this;
    scale(s: number): this;
    lengthSq(): number;
    length(): number;
    normalize(): this;
    equals(v: Vec2, epsilon?: number): boolean;
    toString(): string;
}
export declare function vec2Dot(a: Vec2, b: Vec2): number;
export declare function vec2Lerp(a: Vec2, b: Vec2, t: number, out?: Vec2): Vec2;
//# sourceMappingURL=vec2.d.ts.map