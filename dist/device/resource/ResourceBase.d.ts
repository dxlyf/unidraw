/**
 * 公共资源基类：统一生命周期（destroy 幂等）。
 *
 * 子类只需实现 `destroyNative()` 释放后端原生对象；
 * 需要额外清理（例如纹理缓存视图）时覆盖 `destroy()` 并在最后调用 `super.destroy()`。
 */
export declare abstract class ResourceBase {
    readonly label: string | undefined;
    private _destroyed;
    constructor(label?: string);
    get destroyed(): boolean;
    protected markDestroyed(): void;
    /** 释放后端资源；幂等。 */
    destroy(): void;
    protected abstract destroyNative(): void;
}
//# sourceMappingURL=ResourceBase.d.ts.map