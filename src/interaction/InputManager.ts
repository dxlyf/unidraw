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
export function clientToNdc(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
  out = new Vec2(),
): Vec2 {
  const w = rect.width || 1;
  const h = rect.height || 1;
  out.x = ((clientX - rect.left) / w) * 2 - 1;
  out.y = -(((clientY - rect.top) / h) * 2 - 1);
  return out;
}

export class InputManager {
  readonly canvas: HTMLCanvasElement;
  private readonly _options: Required<InputManagerOptions>;
  private readonly _handlers = new Map<string, Set<(e: never) => void>>();
  private readonly _pointers = new Map<number, PointerState>();
  private readonly _keys = new Set<string>();
  private _disposed = false;
  private _lastClickTime = 0;
  private _teardown: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, options: InputManagerOptions = {}) {
    this.canvas = canvas;
    this._options = {
      preventWheelDefault: options.preventWheelDefault ?? false,
      clickMoveThreshold: options.clickMoveThreshold ?? 6,
      clickTimeThreshold: options.clickTimeThreshold ?? 600,
      doubleClickInterval: options.doubleClickInterval ?? 320,
    };
    this._bind();
  }

  get disposed(): boolean {
    return this._disposed;
  }

  /** 注册事件处理；返回取消注册函数 */
  on(type: PointerEventType, handler: (e: PointerEventInfo) => void): () => void;
  on(type: "keydown" | "keyup", handler: (e: KeyEventInfo) => void): () => void;
  on(type: string, handler: (e: never) => void): () => void {
    let set = this._handlers.get(type);
    if (!set) {
      set = new Set();
      this._handlers.set(type, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  isKeyDown(code: string): boolean {
    return this._keys.has(code);
  }

  get pointers(): ReadonlyMap<number, PointerState> {
    return this._pointers;
  }

  get pointerCount(): number {
    return this._pointers.size;
  }

  private _emit(type: string, info: unknown): void {
    const set = this._handlers.get(type);
    if (!set) return;
    for (const h of set) (h as (e: unknown) => void)(info);
  }

  private _rect(): { left: number; top: number; width: number; height: number } {
    const r = this.canvas.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  private _info(
    type: PointerEventType,
    e: PointerEvent | WheelEvent,
    deltaX = 0,
    deltaY = 0,
    wheelDelta = 0,
  ): PointerEventInfo {
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

  private _bind(): void {
    const canvas = this.canvas;

    const onPointerDown = (e: PointerEvent) => {
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

    const onPointerMove = (e: PointerEvent) => {
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

    const onPointerUp = (e: PointerEvent) => {
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
            this._lastClickTime = 0;
          } else {
            this._lastClickTime = now;
          }
        }
        this._pointers.delete(e.pointerId);
      }
    };

    const onPointerCancel = (e: PointerEvent) => this._pointers.delete(e.pointerId);
    const onPointerEnter = (e: PointerEvent) => this._emit("pointerenter", this._info("pointerenter", e));
    const onPointerLeave = (e: PointerEvent) => this._emit("pointerleave", this._info("pointerleave", e));

    const onWheel = (e: WheelEvent) => {
      if (this._options.preventWheelDefault) e.preventDefault();
      this._emit("wheel", this._info("wheel", e, 0, 0, e.deltaY));
    };

    const onKeyDown = (e: KeyboardEvent) => {
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
      } satisfies KeyEventInfo);
    };
    const onKeyUp = (e: KeyboardEvent) => {
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
      } satisfies KeyEventInfo);
    };
    const onBlur = () => this._keys.clear();
    const onContextMenu = (e: Event) => e.preventDefault();

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

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._teardown?.();
    this._teardown = null;
    this._handlers.clear();
    this._pointers.clear();
    this._keys.clear();
  }
}
