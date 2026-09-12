import type { Mat4 } from "./mat4.js";
import { clamp, equals as numEquals } from "./mmath.js";
import { Quaternion } from "./Quaternion.js";
import type { Vec3 } from "./vec3.js";

/**
 * 欧拉角的旋转顺序：三个字母依次表示「先绕哪个轴、再绕哪个轴、最后绕哪个轴」。
 *
 * 为什么顺序属于姿态的一部分：三次旋转不可交换，x/y/z 数值相同但 order 不同的
 * 两个 Euler 表示完全不同的姿态，因此本类每个转换方法都要显式带上 order。
 */
export type EulerOrder = "XYZ" | "YXZ" | "ZXY" | "ZYX" | "YZX" | "XZY";

/** 默认顺序（与 three.js 的 `Euler.DEFAULT_ORDER` 同值），避免双方对象互换时产生隐式差异。 */
export const DEFAULT_EULER_ORDER: EulerOrder = "XYZ";

/**
 * 模块级临时四元数：`reorder()` 需要「欧拉角 → 四元数 → 新顺序的欧拉角」这一中间
 * 表示，复用它可避免每次调用都分配对象（three.js 也用同样的 _quaternion 手法）。
 */
const _q = new Quaternion();

/**
 * 欧拉角（弧度制）：用三个依次绕轴的角度描述旋转，直观、便于编辑与序列化。
 *
 * 为什么还需要四元数/矩阵：欧拉角有万向节锁（两轴共面时角度分配不唯一），插值
 * 也不能直接对三个角做线性插值。因此本类主要负责「给人调参」与「表示转换」，
 * 需要做运算、插值时请先转成 `Quaternion` 或 `Mat4`。
 *
 * 约定：
 * - 角度单位是**弧度**，与 `Mat4.rotateX/Y/Z` 一致（角度值请先用 `degToRad` 转换）；
 * - 实例方法就地修改并返回 this，便于链式调用（与 Vec3/Mat4 一致）；
 * - 比较姿态请先转成 `Quaternion`/`Mat4`，不要只比较 x/y/z（见 `equals` 的 order 项）。
 */
export class Euler {
  x: number;
  y: number;
  z: number;
  order: EulerOrder;

  readonly isEuler: boolean = true;

  /** 全部合法顺序（顺序与 three.js 的 `Euler.RotationOrders` 一致）。 */
  static readonly RotationOrders: readonly EulerOrder[] = ["XYZ", "YXZ", "ZXY", "ZYX", "YZX", "XZY"];
  /** three.js 的同名静态常量，指向 `DEFAULT_EULER_ORDER`。 */
  static readonly DefaultOrder: EulerOrder = DEFAULT_EULER_ORDER;

  constructor(x = 0, y = 0, z = 0, order: EulerOrder = DEFAULT_EULER_ORDER) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.order = order;
  }

  set(x: number, y: number, z: number, order: EulerOrder = this.order): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.order = order;
    return this;
  }

  copy(e: Euler): this {
    this.x = e.x;
    this.y = e.y;
    this.z = e.z;
    this.order = e.order;
    return this;
  }

  clone(): Euler {
    return new Euler(this.x, this.y, this.z, this.order);
  }

  /** 直接把向量当作 x/y/z 三个角；order 缺省沿用当前顺序。 */
  setFromVector3(v: Vec3, order: EulerOrder = this.order): this {
    return this.set(v.x, v.y, v.z, order);
  }

  /**
   * 由（单位）四元数反解欧拉角。
   *
   * 为什么不像 three.js 那样先 `makeRotationFromQuaternion` 再走
   * `setFromRotationMatrix`：three.js 的 Matrix4 用普通 number（float64）存储，
   * 而本库的 `Mat4.elements` 是 **Float32Array**，绕一圈会把四元数 ~1e-16 的精度
   * 截断成 ~1e-7。这里在 float64 上展开同一套列主序 3x3 公式，再交给同一段提取
   * 逻辑，既保精度又不必重写六种 order 的分支。
   *
   * @param update 与 three.js 签名对齐，见 `setFromRotationMatrix`。
   */
  setFromQuaternion(q: Quaternion, order: EulerOrder = this.order, update = true): this {
    const x = q.x;
    const y = q.y;
    const z = q.z;
    const w = q.w;
    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;
    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;

    return this.setFromRotationElements(
      1 - (yy + zz),
      xy - wz,
      xz + wy,
      xy + wz,
      1 - (xx + zz),
      yz - wx,
      xz - wy,
      yz + wx,
      1 - (xx + yy),
      order,
      update,
    );
  }

  /**
   * 由**纯旋转**矩阵（只取左上 3x3）反解欧拉角。
   *
   * 本库 Mat4 的布局假设（重要）：`elements` 是长度 16 的 **Float32Array**，
   * **列主序**——数学上的第 i 行第 j 列元素 `m_ij = elements[(j-1) * 4 + (i-1)]`。
   * 于是第一行是 `m11=te[0], m12=te[4], m13=te[8]`，第二行 `m21=te[1]…`，
   * 平移量在 `te[12..14]`（对旋转提取无影响）。若矩阵换成行主序，下面的公式会
   * 全部错位，所以这里显式按列主序取元素并集中命名。
   *
   * 输入必须是正交且行列式为 +1 的旋转矩阵（含缩放时请先用 `Mat4.decompose`
   * 剥离缩放，否则角度不再可靠）。
   *
   * @param order 目标旋转顺序，缺省沿用 this.order
   * @param update 与 three.js 签名对齐：three.js 用它触发 `_onChangeCallback`。
   *   本库的数学类没有观察者机制（Vec3/Mat4 也都没有），因此它不改变计算结果；
   *   显式读一次，既说明「有意忽略」，也避免触发 noUnusedParameters。
   */
  setFromRotationMatrix(m: Mat4, order: EulerOrder = this.order, update = true): this {
    const te = m.elements;
    return this.setFromRotationElements(
      te[0],
      te[4],
      te[8],
      te[1],
      te[5],
      te[9],
      te[2],
      te[6],
      te[10],
      order,
      update,
    );
  }

  /**
   * 六个旋转顺序各自的提取公式（three.js 同款）。
   *
   * 为什么必须按 order 分支：欧拉角与旋转矩阵不是一一对应，不同顺序下「哪个元素
   * 是中间轴的 sin、另外两个角该用哪两个元素做 atan2」完全不同，没有任何公式能
   * 靠换参数覆盖全部情况，只能逐一写全。
   *
   * 中间轴的角用 `asin` 反解，所以先 clamp 到 [-1, 1]：Float32 矩阵算出的 sin 常是
   * 1.0000001 这种，直接 asin 会得到 NaN（three.js 同样 clamp）。当 |sin| 接近 1
   * 时进入**万向节锁**，另外两个角无法唯一确定，约定把其中一个取 0、把旋转全部
   * 记到另一个角上（与 three.js 一致），保证输出确定而不是随浮点抖动。
   */
  private setFromRotationElements(
    m11: number,
    m12: number,
    m13: number,
    m21: number,
    m22: number,
    m23: number,
    m31: number,
    m32: number,
    m33: number,
    order: EulerOrder,
    update: boolean,
  ): this {
    switch (order) {
      case "XYZ":
        this.y = Math.asin(clamp(m13, -1, 1));
        if (Math.abs(m13) < 0.9999999) {
          this.x = Math.atan2(-m23, m33);
          this.z = Math.atan2(-m12, m11);
        } else {
          this.x = Math.atan2(m32, m22);
          this.z = 0;
        }
        break;
      case "YXZ":
        this.x = Math.asin(-clamp(m23, -1, 1));
        if (Math.abs(m23) < 0.9999999) {
          this.y = Math.atan2(m13, m33);
          this.z = Math.atan2(m21, m22);
        } else {
          this.y = Math.atan2(-m31, m11);
          this.z = 0;
        }
        break;
      case "ZXY":
        this.x = Math.asin(clamp(m32, -1, 1));
        if (Math.abs(m32) < 0.9999999) {
          this.y = Math.atan2(-m31, m33);
          this.z = Math.atan2(-m12, m22);
        } else {
          this.y = 0;
          this.z = Math.atan2(m21, m11);
        }
        break;
      case "ZYX":
        this.y = Math.asin(-clamp(m31, -1, 1));
        if (Math.abs(m31) < 0.9999999) {
          this.x = Math.atan2(m32, m33);
          this.z = Math.atan2(m21, m11);
        } else {
          this.x = 0;
          this.z = Math.atan2(-m12, m22);
        }
        break;
      case "YZX":
        this.z = Math.asin(clamp(m21, -1, 1));
        if (Math.abs(m21) < 0.9999999) {
          this.x = Math.atan2(-m23, m22);
          this.y = Math.atan2(-m31, m11);
        } else {
          this.x = 0;
          this.y = Math.atan2(m13, m33);
        }
        break;
      case "XZY":
        this.z = Math.asin(-clamp(m12, -1, 1));
        if (Math.abs(m12) < 0.9999999) {
          this.x = Math.atan2(m32, m22);
          this.y = Math.atan2(m13, m11);
        } else {
          this.x = Math.atan2(-m23, m33);
          this.y = 0;
        }
        break;
    }

    this.order = order;
    void update;
    return this;
  }

  /**
   * 换一个旋转顺序，**保持姿态不变**（三个角会随之改变）。
   *
   * 必须经四元数中转：直接重排 x/y/z 得到的是完全不同的姿态。
   */
  reorder(newOrder: EulerOrder): this {
    _q.setFromEuler(this);
    return this.setFromQuaternion(_q, newOrder);
  }

  /**
   * 逐分量比较（epsilon 缺省用 mmath 的 EPSILON，与 Vec3 保持一致）。
   *
   * order 也参与比较：x/y/z 相同但顺序不同意味着不同姿态，只比数值会把两个
   * 完全不同的旋转判成相等。
   */
  equals(e: Euler, epsilon?: number): boolean {
    return (
      numEquals(this.x, e.x, epsilon) &&
      numEquals(this.y, e.y, epsilon) &&
      numEquals(this.z, e.z, epsilon) &&
      this.order === e.order
    );
  }

  /**
   * 依次写入 [x, y, z]；缺省追加进一个新数组。
   *
   * 只序列化三个角：order 是字符串，塞进 `number[]` 会破坏类型，因此
   * `fromArray` 也不读它（需要连同 order 一起存取时请用 `toString`/自定义编码）。
   */
  toArray(array: number[] = [], offset = 0): number[] {
    array[offset] = this.x;
    array[offset + 1] = this.y;
    array[offset + 2] = this.z;
    return array;
  }

  /** 从 [x, y, z] 读取；接受 Float32Array 等类数组。order 保持不变。 */
  fromArray(array: ArrayLike<number>, offset = 0): this {
    this.x = array[offset];
    this.y = array[offset + 1];
    this.z = array[offset + 2];
    return this;
  }

  toString(): string {
    return `Euler(x=${this.x.toFixed(4)}, y=${this.y.toFixed(4)}, z=${this.z.toFixed(4)}, order=${this.order})`;
  }
}
