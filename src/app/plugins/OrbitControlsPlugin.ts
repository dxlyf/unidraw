/**
 * OrbitControlsPlugin —— 轨道相机插件（拖拽旋转 / 滚轮缩放）。
 *
 * 与 examples/common 的演示版不同：这里完全基于 `InputManager`（NDC + 生命周期都在框架内），
 * 注册到 `App` 后自动随 App 销毁；`dragging` / `draggedDistance` 供拾取逻辑判断
 * “这次 pointerup 是拖拽而不是点击”。
 */

import { BasePlugin, type PluginContext } from "../Plugin.js";
import { clamp, degToRad } from "../../math/mmath.js";

export interface OrbitControlsOptions {
  /** 旋转灵敏度（弧度/像素），默认 0.005 */
  rotateSpeed?: number;
  /** 缩放灵敏度，默认 0.002 */
  zoomSpeed?: number;
  /** 最近距离，默认 0.5 */
  minDistance?: number;
  /** 最远距离，默认 500 */
  maxDistance?: number;
  /** 俯仰角下限（弧度），默认 -89° */
  minPitch?: number;
  /** 俯仰角上限（弧度），默认 89° */
  maxPitch?: number;
  /** 是否允许拖拽旋转（默认 true） */
  enableRotate?: boolean;
  /** 是否允许滚轮缩放（默认 true） */
  enableZoom?: boolean;
  /** 拖拽超过该像素数（CSS px）视为“拖动”而不是“点击”，默认 4 */
  dragThreshold?: number;
}

export class OrbitControlsPlugin extends BasePlugin {
  rotateSpeed: number;
  zoomSpeed: number;
  minDistance: number;
  maxDistance: number;
  minPitch: number;
  maxPitch: number;
  enableRotate: boolean;
  enableZoom: boolean;
  dragThreshold: number;

  /** 当前是否正在拖拽 */
  dragging = false;
  /** 本次拖拽累计位移（CSS 像素） */
  draggedDistance = 0;

  private _lastX = 0;
  private _lastY = 0;
  private readonly _off: (() => void)[] = [];

  constructor(options: OrbitControlsOptions = {}) {
    super("OrbitControlsPlugin");
    this.rotateSpeed = options.rotateSpeed ?? 0.005;
    this.zoomSpeed = options.zoomSpeed ?? 0.002;
    this.minDistance = options.minDistance ?? 0.5;
    this.maxDistance = options.maxDistance ?? 500;
    this.minPitch = options.minPitch ?? degToRad(-89);
    this.maxPitch = options.maxPitch ?? degToRad(89);
    this.enableRotate = options.enableRotate ?? true;
    this.enableZoom = options.enableZoom ?? true;
    this.dragThreshold = options.dragThreshold ?? 4;
  }

  /** 本次交互是否应当被当作「点击」（供拾取插件使用） */
  get isClick(): boolean {
    return this.draggedDistance <= this.dragThreshold;
  }

  setup(ctx: PluginContext): void {
    const input = ctx.input;
    if (!input) return;
    const canvas = input.canvas;
    const camera = ctx.camera;

    this._off.push(
      input.on("pointerdown", (e) => {
        this.dragging = true;
        this.draggedDistance = 0;
        this._lastX = e.clientX;
        this._lastY = e.clientY;
        canvas.setPointerCapture?.(e.pointerId);
      }),
      input.on("pointermove", (e) => {
        if (!this.dragging) return;
        const dx = e.clientX - this._lastX;
        const dy = e.clientY - this._lastY;
        if (dx === 0 && dy === 0) return;
        this._lastX = e.clientX;
        this._lastY = e.clientY;
        this.draggedDistance += Math.hypot(dx, dy);
        if (!this.enableRotate) return;
        camera.yaw -= dx * this.rotateSpeed;
        camera.pitch = clamp(camera.pitch - dy * this.rotateSpeed, this.minPitch, this.maxPitch);
        camera.update();
      }),
      input.on("pointerup", (e) => {
        this.dragging = false;
        canvas.releasePointerCapture?.(e.pointerId);
      }),
      input.on("pointerleave", () => {
        this.dragging = false;
      }),
      input.on("wheel", (e) => {
        if (!this.enableZoom) return;
        camera.distance = clamp(
          camera.distance * (1 + e.wheelDelta * this.zoomSpeed),
          this.minDistance,
          this.maxDistance,
        );
        camera.update();
      }),
    );
  }

  dispose(): void {
    for (const off of this._off) off();
    this._off.length = 0;
  }
}
