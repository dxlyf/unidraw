/**
 * 公共资源基类：统一生命周期（destroy 幂等）。
 *
 * 子类只需实现 `destroyNative()` 释放后端原生对象；
 * 需要额外清理（例如纹理缓存视图）时覆盖 `destroy()` 并在最后调用 `super.destroy()`。
 */
export abstract class ResourceBase {
  readonly label: string | undefined;
  private _destroyed = false;

  constructor(label?: string) {
    this.label = label;
  }

  get destroyed(): boolean {
    return this._destroyed;
  }

  protected markDestroyed(): void {
    this._destroyed = true;
  }

  /** 释放后端资源；幂等。 */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this.destroyNative();
  }

  protected abstract destroyNative(): void;
}
