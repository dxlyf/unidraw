/**
 * InputManager —— 交互输入统一入口。
 *
 * - 指针事件统一为 NDC 坐标（画布左上为原点 → NDC，y 向上为正），直接喂给 Raycaster；
 * - 合成 click / dblclick（按下-抬起位移与时间阈值），拖拽与点击不互相干扰；
 * - 多指（pointerId）状态、滚轮、键盘按键集合；
 * - 所有监听在 dispose() 中移除，适合在插件/组件卸载时调用。
 */
import { Vec2 } from "../math/vec2.js";
/** 画布 client 坐标 → NDC（-1..1，y 向上） */
export function clientToNdc(rect, clientX, clientY, out = new Vec2()) {
    const w = rect.width || 1;
    const h = rect.height || 1;
    out.x = ((clientX - rect.left) / w) * 2 - 1;
    out.y = -(((clientY - rect.top) / h) * 2 - 1);
    return out;
}
export class InputManager {
    canvas;
    _options;
    _handlers = new Map();
    _pointers = new Map();
    _keys = new Set();
    _disposed = false;
    /**
     * 上一次 click 的时间戳。
     * 初值必须是 -Infinity：`performance.now()` 的原点可能是页面/进程启动
     * （Node、刚加载的页面都接近 0），若用 0 则「第一次点击」会被误判成双击。
     */
    _lastClickTime = Number.NEGATIVE_INFINITY;
    _teardown = null;
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this._options = {
            preventWheelDefault: options.preventWheelDefault ?? false,
            clickMoveThreshold: options.clickMoveThreshold ?? 6,
            clickTimeThreshold: options.clickTimeThreshold ?? 600,
            doubleClickInterval: options.doubleClickInterval ?? 320,
        };
        this._bind();
    }
    get disposed() {
        return this._disposed;
    }
    on(type, handler) {
        let set = this._handlers.get(type);
        if (!set) {
            set = new Set();
            this._handlers.set(type, set);
        }
        set.add(handler);
        return () => set.delete(handler);
    }
    isKeyDown(code) {
        return this._keys.has(code);
    }
    get pointers() {
        return this._pointers;
    }
    get pointerCount() {
        return this._pointers.size;
    }
    _emit(type, info) {
        const set = this._handlers.get(type);
        if (!set)
            return;
        for (const h of set)
            h(info);
    }
    _rect() {
        const r = this.canvas.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    _info(type, e, deltaX = 0, deltaY = 0, wheelDelta = 0) {
        return {
            type,
            pointerId: "pointerId" in e ? e.pointerId : 1,
            ndc: clientToNdc(this._rect(), e.clientX, e.clientY),
            clientX: e.clientX,
            clientY: e.clientY,
            deltaX,
            deltaY,
            wheelDelta,
            buttons: e.buttons,
            pointerType: "pointerType" in e ? e.pointerType : "mouse",
            shiftKey: e.shiftKey,
            ctrlKey: e.ctrlKey,
            altKey: e.altKey,
            time: performance.now(),
            originalEvent: e,
        };
    }
    _bind() {
        const canvas = this.canvas;
        const onPointerDown = (e) => {
            const ndc = clientToNdc(this._rect(), e.clientX, e.clientY);
            const now = performance.now();
            this._pointers.set(e.pointerId, {
                pointerId: e.pointerId,
                ndc,
                clientX: e.clientX,
                clientY: e.clientY,
                down: true,
                downTime: now,
                downX: e.clientX,
                downY: e.clientY,
                moved: 0,
            });
            this._emit("pointerdown", this._info("pointerdown", e));
        };
        const onPointerMove = (e) => {
            const state = this._pointers.get(e.pointerId);
            let dx = 0;
            let dy = 0;
            if (state) {
                dx = e.clientX - state.clientX;
                dy = e.clientY - state.clientY;
                state.moved += Math.hypot(dx, dy);
                state.clientX = e.clientX;
                state.clientY = e.clientY;
                state.ndc = clientToNdc(this._rect(), e.clientX, e.clientY);
            }
            this._emit("pointermove", this._info("pointermove", e, dx, dy));
        };
        const onPointerUp = (e) => {
            const state = this._pointers.get(e.pointerId);
            this._emit("pointerup", this._info("pointerup", e));
            if (state) {
                const dist = Math.hypot(e.clientX - state.downX, e.clientY - state.downY);
                const dt = performance.now() - state.downTime;
                if (dist <= this._options.clickMoveThreshold && dt <= this._options.clickTimeThreshold) {
                    this._emit("click", this._info("click", e));
                    const now = performance.now();
                    if (now - this._lastClickTime <= this._options.doubleClickInterval) {
                        this._emit("dblclick", this._info("dblclick", e));
                        this._lastClickTime = Number.NEGATIVE_INFINITY;
                    }
                    else {
                        this._lastClickTime = now;
                    }
                }
                this._pointers.delete(e.pointerId);
            }
        };
        const onPointerCancel = (e) => this._pointers.delete(e.pointerId);
        const onPointerEnter = (e) => this._emit("pointerenter", this._info("pointerenter", e));
        const onPointerLeave = (e) => this._emit("pointerleave", this._info("pointerleave", e));
        const onWheel = (e) => {
            if (this._options.preventWheelDefault)
                e.preventDefault();
            this._emit("wheel", this._info("wheel", e, 0, 0, e.deltaY));
        };
        const onKeyDown = (e) => {
            this._keys.add(e.code);
            this._emit("keydown", {
                type: "keydown",
                code: e.code,
                key: e.key,
                shiftKey: e.shiftKey,
                ctrlKey: e.ctrlKey,
                altKey: e.altKey,
                repeat: e.repeat,
                originalEvent: e,
            });
        };
        const onKeyUp = (e) => {
            this._keys.delete(e.code);
            this._emit("keyup", {
                type: "keyup",
                code: e.code,
                key: e.key,
                shiftKey: e.shiftKey,
                ctrlKey: e.ctrlKey,
                altKey: e.altKey,
                repeat: e.repeat,
                originalEvent: e,
            });
        };
        const onBlur = () => this._keys.clear();
        const onContextMenu = (e) => e.preventDefault();
        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup", onPointerUp);
        canvas.addEventListener("pointercancel", onPointerCancel);
        canvas.addEventListener("pointerenter", onPointerEnter);
        canvas.addEventListener("pointerleave", onPointerLeave);
        canvas.addEventListener("wheel", onWheel, { passive: !this._options.preventWheelDefault });
        canvas.addEventListener("contextmenu", onContextMenu);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);
        this._teardown = () => {
            canvas.removeEventListener("pointerdown", onPointerDown);
            canvas.removeEventListener("pointermove", onPointerMove);
            canvas.removeEventListener("pointerup", onPointerUp);
            canvas.removeEventListener("pointercancel", onPointerCancel);
            canvas.removeEventListener("pointerenter", onPointerEnter);
            canvas.removeEventListener("pointerleave", onPointerLeave);
            canvas.removeEventListener("wheel", onWheel);
            canvas.removeEventListener("contextmenu", onContextMenu);
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", onBlur);
        };
    }
    dispose() {
        if (this._disposed)
            return;
        this._disposed = true;
        this._teardown?.();
        this._teardown = null;
        this._handlers.clear();
        this._pointers.clear();
        this._keys.clear();
    }
}
//# sourceMappingURL=InputManager.js.map