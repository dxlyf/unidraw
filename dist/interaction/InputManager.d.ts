/**
 * InputManager —— 交互输入统一入口。
 *
 * - 指针事件统一为 NDC 坐标（画布左上为原点 → NDC，y 向上为正），直接喂给 Raycaster；
 * - 合成 click / dblclick（按下-抬起位移与时间阈值），拖拽与点击不互相干扰；
 * - 多指（pointerId）状态、滚轮、键盘按键集合；
 * - 所有监听在 dispose() 中移除，适合在插件/组件卸载时调用。
 */
import { Vec2 } from "../math/vec2.js";
export type PointerEventType = "pointerdown" | "pointerup" | "pointermove" | "pointerenter" | "pointerleave" | "wheel" | "click" | "dblclick";
export interface PointerEventInfo {
    type: PointerEventType;
    pointerId: number;
    /** 归一化设备坐标（-1..1，y 向上） */
    ndc: Vec2;
    clientX: number;
    clientY: number;
    /** 自上次事件以来的 CSS 像素位移 */
    deltaX: number;
    deltaY: number;
    /** 滚轮增量（浏览器原始值） */
    wheelDelta: number;
    buttons: number;
    pointerType: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    /** performance.now() 时间戳（毫秒） */
    time: number;
    originalEvent: Event;
}
export interface KeyEventInfo {
    type: "keydown" | "keyup";
    code: string;
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    repeat: boolean;
    originalEvent: KeyboardEvent;
}
export interface PointerState {
    pointerId: number;
    ndc: Vec2;
    clientX: number;
    clientY: number;
    down: boolean;
    downTime: number;
    downX: number;
    downY: number;
    /** 按下以来的累计位移（CSS 像素），用于区分点击与拖拽 */
    moved: number;
}
export interface InputManagerOptions {
    /** 滚轮是否阻止默认行为（页面内缩放时设为 true），默认 false */
    preventWheelDefault?: boolean;
    /** click 判定的最大位移（CSS 像素），默认 6 */
    clickMoveThreshold?: number;
    /** click 判定的最大按下时长（毫秒），默认 600 */
    clickTimeThreshold?: number;
    /** dblclick 间隔（毫秒），默认 320 */
    doubleClickInterval?: number;
}
/** 画布 client 坐标 → NDC（-1..1，y 向上） */
export declare function clientToNdc(rect: {
    left: number;
    top: number;
    width: number;
    height: number;
}, clientX: number, clientY: number, out?: Vec2): Vec2;
export declare class InputManager {
    readonly canvas: HTMLCanvasElement;
    private readonly _options;
    private readonly _handlers;
    private readonly _pointers;
    private readonly _keys;
    private _disposed;
    /**
     * 上一次 click 的时间戳。
     * 初值必须是 -Infinity：`performance.now()` 的原点可能是页面/进程启动
     * （Node、刚加载的页面都接近 0），若用 0 则「第一次点击」会被误判成双击。
     */
    private _lastClickTime;
    private _teardown;
    constructor(canvas: HTMLCanvasElement, options?: InputManagerOptions);
    get disposed(): boolean;
    /** 注册事件处理；返回取消注册函数 */
    on(type: PointerEventType, handler: (e: PointerEventInfo) => void): () => void;
    on(type: "keydown" | "keyup", handler: (e: KeyEventInfo) => void): () => void;
    isKeyDown(code: string): boolean;
    get pointers(): ReadonlyMap<number, PointerState>;
    get pointerCount(): number;
    private _emit;
    private _rect;
    private _info;
    private _bind;
    dispose(): void;
}
//# sourceMappingURL=InputManager.d.ts.map