/**
 * HighlightPlugin —— 悬停/选中高亮插件（GPU 颜色拾取 + 材质接管）。
 *
 * 用法：
 * ```ts
 * app.use(new HighlightPlugin({
 *   highlight: new UnlitColorMaterial(device, new Color().setHex("#ffe066")),
 *   skipWhileDragging: () => orbit.dragging,   // 拖动相机时不拾取
 *   onHover: (mesh) => console.log(mesh?.name),
 *   onSelect: (mesh) => { ... },
 * }));
 * ```
 *
 * 语义：
 * - **选中（selected）与悬停（hovered）可以同时高亮**：插件用一张 Map 记住每个被
 *   接管材质对象的原材质，离开高亮集合时精确恢复，不会互相踩掉；
 * - 每次拾取都用当前场景/相机重绘 ID pass（`autoInvalidate=true`，默认），
 *   避免读到过期 ID 目标导致「高亮到错误物体」；若要省一次 pass，可设
 *   `autoInvalidate: false` 并在场景/相机变化后自己调用 `invalidate()`；
 * - 拾取是异步的（一次 GPU→CPU 回读）：鼠标快速移动时高亮会略微滞后于光标；
 *   需要「零延迟、与光标严格一致」的悬停反馈时，建议用同步的 `Raycaster`
 *   （见 examples/picking）。
 */

import { BasePlugin, type PluginContext } from "../Plugin.js";
import type { MaterialLike } from "../../scene/types.js";
import type { Mesh } from "../../render/Mesh.js";
import type { Vec2 } from "../../math/vec2.js";
import type { Camera } from "../../render/Camera.js";
import type { Node3D } from "../../scene/Node3D.js";
import type { ColorPicker, ColorPickOptions, ColorPickResult } from "../../picking/ColorPicker.js";

/** 可替换的拾取来源（默认用 `ctx.picker`，即 GPU 颜色拾取） */
export interface PickSource {
  pick(scene: Node3D, camera: Camera, ndc: { x: number; y: number }, options?: ColorPickOptions): Promise<ColorPickResult>;
}

export interface HighlightPluginOptions {
  /** 高亮材质（必填） */
  highlight: MaterialLike;
  /** 是否响应悬停（默认 true） */
  hover?: boolean;
  /** 是否响应点击选中（默认 true） */
  select?: boolean;
  /**
   * 悬停拾取前是否重绘 ID pass（默认 true）。
   * 设为 false 可省一次 ID pass，但场景/相机变化后必须自行 `invalidate()`。
   */
  autoInvalidate?: boolean;
  /** 拾取范围过滤 */
  filter?: (mesh: Mesh) => boolean;
  /** 自定义拾取来源（默认 `ctx.picker`；也可换成射线拾取的适配器） */
  picker?: PickSource;
  onHover?(mesh: Mesh | null): void;
  onSelect?(mesh: Mesh | null): void;
  /** 返回 true 时跳过拾取（例如正在拖动相机） */
  skipWhileDragging?: () => boolean;
}

export class HighlightPlugin extends BasePlugin {
  private readonly _options: HighlightPluginOptions;
  private readonly _off: (() => void)[] = [];
  private readonly _taken = new Map<Mesh, MaterialLike | null>();
  private _hovered: Mesh | null = null;
  private _selected: Mesh | null = null;
  private _pending: Vec2 | null = null;
  private _picker: ColorPicker | null = null;
  private _picking = false;
  private _ctx: PluginContext | null = null;

  constructor(options: HighlightPluginOptions) {
    super("HighlightPlugin");
    this._options = options;
  }

  get hovered(): Mesh | null {
    return this._hovered;
  }

  get selected(): Mesh | null {
    return this._selected;
  }

  /** 当前被高亮接管的对象数（选中 + 悬停，去重） */
  get highlightedCount(): number {
    return this._taken.size;
  }

  /** 标记「ID 目标已过期」（`autoInvalidate: false` 时场景/相机变化后调用） */
  invalidate(): void {
    this._picker?.invalidate();
  }

  setup(ctx: PluginContext): void {
    this._ctx = ctx;
    this._picker = ctx.picker;
    const input = ctx.input;
    if (!input) return;

    if (this._options.hover !== false) {
      this._off.push(
        input.on("pointermove", (e) => {
          if (this._options.skipWhileDragging?.()) return;
          this._pending = e.ndc.clone();
        }),
        input.on("pointerleave", () => {
          this._pending = null;
          this._applyHover(null);
        }),
      );
    }

    if (this._options.select !== false) {
      this._off.push(
        input.on("click", (e) => {
          if (this._options.skipWhileDragging?.()) return;
          void this._pick(ctx, e.ndc).then((mesh) => this._applySelect(mesh));
        }),
      );
    }
  }

  update(ctx: PluginContext, dt: number): void {
    void dt;
    if (this._options.hover === false) return;
    const point = this._pending;
    if (!point) return;
    // 只保留最新位置；拾取进行中时不发新请求（避免回读排队拖慢）
    this._pending = null;
    if (this._picking) return;
    this._picking = true;
    void this._pick(ctx, point)
      .then((mesh) => this._applyHover(mesh))
      .finally(() => {
        this._picking = false;
      });
  }

  /** 清空选中（保留悬停状态） */
  clearSelection(): void {
    this._selected = null;
    this._refresh();
  }

  /**
   * 以给定 NDC **立即**拾取并更新悬停状态（供程序化调用：触摸、外部射线拾取、测试）。
   * 返回命中的 Mesh。
   */
  async hoverAt(ndc: { x: number; y: number }): Promise<Mesh | null> {
    const mesh = await this._pick(this._requireCtx(), ndc);
    this._applyHover(mesh);
    return mesh;
  }

  /** 以给定 NDC **立即**拾取并更新选中状态。返回命中的 Mesh。 */
  async selectAt(ndc: { x: number; y: number }): Promise<Mesh | null> {
    const mesh = await this._pick(this._requireCtx(), ndc);
    this._applySelect(mesh);
    return mesh;
  }

  dispose(): void {
    for (const off of this._off) off();
    this._off.length = 0;
    // 精确恢复所有被接管的材质
    for (const [mesh, material] of this._taken) mesh.material = material;
    this._taken.clear();
    this._hovered = null;
    this._selected = null;
  }

  // ---- 内部 ---------------------------------------------------------------

  private _requireCtx(): PluginContext {
    const ctx = this._ctx;
    if (!ctx) throw new Error("[unidraw] HighlightPlugin 尚未 setup（请通过 app.use() 注册）");
    return ctx;
  }

  private async _pick(ctx: PluginContext, ndc: Vec2 | { x: number; y: number }): Promise<Mesh | null> {
    const picker = this._options.picker ?? this._picker ?? ctx.picker;
    const result = await picker.pick(ctx.scene, ctx.camera, { x: ndc.x, y: ndc.y }, {
      filter: this._options.filter,
      refresh: this._options.autoInvalidate !== false,
    });
    const mesh = result.mesh;
    // 只对「可见」的对象生效（避免高亮到刚被隐藏/移除的对象）
    if (mesh && !mesh.visible) return null;
    return mesh;
  }

  private _applyHover(mesh: Mesh | null): void {
    if (mesh === this._hovered) return;
    this._hovered = mesh;
    this._refresh();
    this._options.onHover?.(mesh);
  }

  private _applySelect(mesh: Mesh | null): void {
    if (mesh === this._selected) return;
    this._selected = mesh;
    this._refresh();
    this._options.onSelect?.(mesh);
  }

  /** 让「选中 ∪ 悬停」都处于高亮：接管缺失的，恢复多余的 */
  private _refresh(): void {
    const wanted = new Set<Mesh>();
    if (this._selected) wanted.add(this._selected);
    if (this._hovered) wanted.add(this._hovered);

    // 恢复不再需要高亮的对象
    for (const [mesh, material] of [...this._taken]) {
      if (!wanted.has(mesh)) {
        mesh.material = material;
        this._taken.delete(mesh);
      }
    }
    // 接管新加入高亮集合的对象
    for (const mesh of wanted) {
      if (this._taken.has(mesh)) continue;
      this._taken.set(mesh, mesh.material);
      mesh.material = this._options.highlight;
    }
  }
}
