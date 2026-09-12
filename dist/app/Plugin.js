/**
 * Plugin —— App 的扩展点。
 *
 * 生命周期（按注册顺序依次调用，dispose 逆序）：
 *   setup → (update → beforeRender → afterRender)* → resize / dispose
 *
 * - `setup`：App 已就绪（device/renderer/scene/camera/input 都能用）；
 *   需要异步资源时返回 Promise（`App` 会 await `use()`）；
 * - `update`：每帧、在渲染之前（动画/逻辑）；
 * - `beforeRender` / `afterRender`：进入/离开渲染通道时（可叠加描边、UI、后处理）；
 * - `resize`：画布像素尺寸变化时；
 * - `dispose`：App 销毁时（释放纹理/监听等）。
 */
/** 类型辅助：让插件对象字面量获得完整类型检查 */
export function definePlugin(plugin) {
    return plugin;
}
/** 插件集合的辅助基类（可选继承，省去手写 name） */
export class BasePlugin {
    name;
    constructor(name) {
        this.name = name;
    }
}
//# sourceMappingURL=Plugin.js.map