/**
 * HighlightPlugin —— 悬停/选中高亮插件（GPU 颜色拾取 + 材质替换）。
 *
 * 用法：
 * ```ts
 * app.use(new HighlightPlugin({
 *   highlight: new UnlitColorMaterial(device, new Color().setHex("#ffe066")),
 *   onHover: (mesh) => console.log(mesh?.name),
 *   onSelect: (mesh) => { ... },
 * }));
 * ```
 *
 * 实现要点：
 * - 每帧最多拾取一次（pointermove 只标记脏，`update` 里按需拾取），避免频繁 GPU→CPU 回读；
 * - 相机/场景变化时通过 `invalidate()` 或 `autoInvalidate`（默认每帧重拾取 hover）控制开销；
 * - 保存/恢复原材质，因此与业务材质替换不冲突（恢复的是插件接管前的材质）。
 */

import { BasePlugin, type PluginContext } from "../Plugin.js";
import type { MaterialLike } from "../../scene/types.js";
import type { Mesh } from "../../render/Mesh.js";
import type { Vec2 } from "../../math/vec2.js";
import type { ColorPicker } from "../../picking/ColorPicker.js";

export interface HighlightPluginOptions {
  /** 高亮材质（必填） */
  highlight: MaterialLike;
  /** 是否响应悬停（默认 true） */
  hover?: boolean;
  /** 是否响应点击选中（默认 true） */
  select?: boolean;
  /** 悬停时是否每帧重新拾取（默认 true；静止场景可设 false + 手动 invalidate()） */
  autoInvalidate?: boolean;
  /** 拾取范围过滤 */
  filter?: (mesh: Mesh) => boolean;
  onHover?(mesh: Mesh | null): void;
  onSelect?(mesh: Mesh | null): void;
  /** 拖拽（轨道相机）时不触发选中，默认 true */
  skipWhileDragging?: () => boolean;
}

interface Restore {
  mesh: Mesh;
  material: MaterialLike | null;
}

export class HighlightPlugin extends BasePlugin {
  private readonly _options: HighlightPluginOptions;
  private readonly _off: (() => void)[] = [];
  private _hovered: Mesh | null = null;
  private _selected: Mesh | null = null;
  private _restore: Restore | null = null;
  private _pending: Vec2 | null = null;
  private _picker: ColorPicker | null = null;
  private _picking = false;

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

  /** 标记「下一帧需要重新拾取悬停」 */
  invalidate(): void {
    this._picker?.invalidate();
  }

  setup(ctx: PluginContext): void {
    this._picker = ctx.picker;
    const input = ctx.input;
    if (!input) return;

    if (this._options.hover !== false) {
      this._off.push(
        input.on("pointermove", (e) => {
          this._pending = e.ndc.clone();
        }),
        input.on("pointerleave", () => {
          this._pending = null;
          this._applyHover(null, ctx);
        }),
      );
    }

    if (this._options.select !== false) {
      this._off.push(
        input.on("click", (e) => {
          if (this._options.skipWhileDragging?.()) return;
          void this._pick(ctx, e.ndc).then((mesh) => {
            this._applySelect(mesh, ctx);
          });
        }),
      );
    }
  }

  update(ctx: PluginContext, dt: number): void {
    void dt;
    if (this._options.hover === false) return;
    const point = this._pending;
    if (!point) return;
    this._pending = null;
    if (this._picking) return;
    this._picking = true;
    void this._pick(ctx, point)
      .then((mesh) => this._applyHover(mesh, ctx))
      .finally(() => {
        this._picking = false;
      });
  }

  dispose(): void {
    for (const off of this._off) off();
    this._off.length = 0;
    if (this._restore) {
      this._restore.mesh.material = this._restore.material;
      this._restore = null;
    }
    this._hovered = null;
    this._selected = null;
  }

  // ---- 内部 ---------------------------------------------------------------

  private async _pick(ctx: PluginContext, ndc: Vec2 | { x: number; y: number }): Promise<Mesh | null> {
    const picker = this._picker ?? ctx.picker;
    const result = await picker.pick(ctx.scene, ctx.camera, { x: ndc.x, y: ndc.y }, { filter: this._options.filter });
    return result.mesh;
  }

  private _applyHover(mesh: Mesh | null, ctx: PluginContext): void {
    void ctx;
    if (mesh === this._hovered) return;
    this._hovered = mesh;
    this._refreshMaterial();
    this._options.onHover?.(mesh);
  }

  private _applySelect(mesh: Mesh | null, ctx: PluginContext): void {
    void ctx;
    this._selected = mesh;
    this._refreshMaterial();
    this._options.onSelect?.(mesh);
  }

  /** 让「选中 > 悬停 > 原材质」生效（只接管当前高亮对象，恢复其余对象） */
  private _refreshMaterial(): void {
    const target = this._selected ?? this._hovered;
    const current = this._restore;
    if (current && current.mesh !== target) {
      current.mesh.material = current.material;
      this._restore = null;
    }
    if (target && (!this._restore || this._restore.mesh !== target)) {
      this._restore = { mesh: target, material: target.material };
      target.material = this._options.highlight;
    }
  }
}
