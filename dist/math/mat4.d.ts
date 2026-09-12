/**
 * 4x4 矩阵，列主序（column-major），与 OpenGL / WebGPU 着色器一致。
 *
 * 实例方法就地修改并返回 this，便于链式调用：
 * `Mat4.identity().translate(1,0,0).rotateY(rad).scale(2,2,2)`
 * 等价于 M = T * R * S（先缩放、再旋转、最后平移）。
 */
import type { Vec3 } from "./vec3.js";
import type { Quaternion } from "./Quaternion.js";
export declare class Mat4 {
    readonly elements: Float32Array;
    constructor();
    static identity(): Mat4;
    setIdentity(): this;
    copy(m: Mat4): this;
    clone(): Mat4;
    /** this = this * rhs */
    multiply(rhs: Mat4): this;
    /** this = lhs * this */
    premultiply(lhs: Mat4): this;
    /** out = a * b；a 或 b 可与 out 相同。 */
    static multiply(a: Mat4, b: Mat4, out?: Mat4): Mat4;
    /** this = this * T(x,y,z) */
    translate(x: number, y: number, z: number): this;
    rotateX(rad: number): this;
    rotateY(rad: number): this;
    rotateZ(rad: number): this;
    /** this = this * R(axis, rad)，axis 无需单位化。 */
    rotateAxis(axisX: number, axisY: number, axisZ: number, rad: number): this;
    /** 欧拉旋转（弧度，外旋 Z→Y→X，等价于矩阵 Rz * Ry * Rx）。 */
    rotateEuler(xRad: number, yRad: number, zRad: number): this;
    scale(x: number, y: number, z: number): this;
    /** 由平移/旋转/缩放组合出 TRS 矩阵（R 为 3x3 旋转矩阵，按列主序传入 9 个数）。 */
    static fromTRS(tx: number, ty: number, tz: number, rx3x3: Float32Array | number[], sx: number, sy: number, sz: number): Mat4;
    /**
     * 右手系透视投影，NDC 深度约定 **z ∈ [0, 1]**（WebGPU/D3D 风格，Zero-to-One）。
     *
     * 为什么用 ZO：WebGPU 只接受 z∈[0,1]，而 WebGL2 接受 z∈[-1,1]（[0,1] 是其子集），
     * 因此同一矩阵在两种后端都正确；GL 风格（z∈[-1,1]）在 WebGPU 上会把近平面到
     * 中段的深度裁掉。需要 GL 约定时用 `perspectiveGL`。
     */
    static perspective(fovYRad: number, aspect: number, near: number, far: number): Mat4;
    /** OpenGL 风格透视（NDC 深度 z ∈ [-1, 1]）；仅在与自定义 GL 管线对接时使用 */
    static perspectiveGL(fovYRad: number, aspect: number, near: number, far: number): Mat4;
    /**
     * 正交投影。与 `perspective()` 一样使用 **ZO 约定**（NDC z ∈ [0,1]，
     * near 平面 → 0，far 平面 → 1），因此两个后端的裁剪与深度测试行为一致；
     * 需要 GL 的 `[-1,1]` 时可自行缩放（见 `perspectiveGL` 的说明）。
     */
    static ortho(left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4;
    /** 观察矩阵（右手系，摄像机看向 -Z）。 */
    static lookAt(eyeX: number, eyeY: number, eyeZ: number, centerX: number, centerY: number, centerZ: number, upX?: number, upY?: number, upZ?: number): Mat4;
    /** 行列式（高斯消元，带部分主元）。 */
    determinant(): number;
    /** 原地求逆（高斯-约当）；不可逆时保持原样并返回 false。 */
    invert(): boolean;
    static inverse(a: Mat4, out?: Mat4): Mat4 | null;
    /** 连续写入目标 Float32Array（byteOffset 必须 4 字节对齐）。 */
    writeTo(out: Float32Array, byteOffset?: number): void;
    /**
     * 由四元数**构造**旋转矩阵（覆盖平移/缩放；元素按列主序写入，
     * 即 `m[row][col] = elements[col*4 + row]`）。
     */
    makeRotationFromQuaternion(q: Quaternion): this;
    /** 位置 + 旋转 + 缩放 → TRS 矩阵（与 `decompose` 互为逆运算） */
    compose(position: Vec3, quaternion: Quaternion, scale: Vec3): this;
    /**
     * 分解 TRS。缩放取三列长度（行列式为负说明含镜像，X 取负），
     * 再把 3×3 归一化后交给四元数求解 —— 与 three.js 同款做法。
     */
    decompose(position: Vec3, quaternion: Quaternion, scale: Vec3): this;
    /** 直接写平移分量（列主序：第 12/13/14 个元素） */
    setPosition(x: number, y: number, z: number): this;
    /** 转置（原地） */
    transpose(): this;
    /** 只保留 `m` 的旋转部分（各列归一化，去掉缩放） */
    extractRotation(m: Mat4): this;
    equals(other: Mat4, epsilon?: number): boolean;
    toString(): string;
}
//# sourceMappingURL=mat4.d.ts.map