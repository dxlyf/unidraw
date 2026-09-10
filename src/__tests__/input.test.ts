/**
 * InputManager 单元测试（Node 环境用假 canvas/window 驱动）。
 *
 * 覆盖：clientToNdc 归一化、指针 NDC/位移、多指、滚轮、键盘、click/dblclick 合成
 * 阈值、dispose 解绑。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { InputManager, clientToNdc, type PointerEventInfo } from "../interaction/InputManager.js";

type Handler = (e: unknown) => void;

interface FakeTarget {
  addEventListener(type: string, fn: Handler, options?: unknown): void;
  removeEventListener(type: string, fn: Handler): void;
  dispatch(type: string, event: Record<string, unknown>): void;
  count(): number;
}

function fakeTarget(): FakeTarget {
  const listeners = new Map<string, Set<Handler>>();
  return {
    addEventListener(type, fn) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type, event) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
    },
    count() {
      let total = 0;
      for (const set of listeners.values()) total += set.size;
      return total;
    },
  };
}

interface Rig {
  input: InputManager;
  canvas: FakeTarget & { getBoundingClientRect(): { left: number; top: number; width: number; height: number } };
  win: FakeTarget;
  restore(): void;
}

function makeRig(): Rig {
  const canvasTarget = fakeTarget();
  const win = fakeTarget();
  const canvas = Object.assign(canvasTarget, {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }),
  });
  const prevWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = win;
  const input = new InputManager(canvas as unknown as HTMLCanvasElement);
  return {
    input,
    canvas,
    win,
    restore() {
      input.dispose();
      (globalThis as { window?: unknown }).window = prevWindow;
    },
  };
}

function pointer(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    pointerId: 1,
    pointerType: "mouse",
    clientX: 0,
    clientY: 0,
    buttons: 1,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    preventDefault() {},
    ...partial,
  };
}

function keyboard(code: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { code, key: code, shiftKey: false, ctrlKey: false, altKey: false, repeat: false, ...extra };
}

test("clientToNdc：画布内坐标 → NDC（y 向上）", () => {
  const rect = { left: 10, top: 20, width: 200, height: 100 };
  assert.deepEqual(pick(clientToNdc(rect, 110, 70)), { x: 0, y: 0 }, "中心应为 (0,0)");
  assert.deepEqual(pick(clientToNdc(rect, 10, 20)), { x: -1, y: 1 }, "左上角应为 (-1,1)");
  assert.deepEqual(pick(clientToNdc(rect, 210, 120)), { x: 1, y: -1 }, "右下角应为 (1,-1)");
  // 尺寸为 0 时不产生 NaN
  const zero = clientToNdc({ left: 0, top: 0, width: 0, height: 0 }, 5, 5);
  assert.ok(Number.isFinite(zero.x) && Number.isFinite(zero.y));
});

function pick(v: { x: number; y: number }): { x: number; y: number } {
  return { x: Number(v.x.toFixed(6)), y: Number(v.y.toFixed(6)) };
}

test("InputManager：指针 NDC/位移/多指，滚轮与键盘", () => {
  const rig = makeRig();
  try {
    const moves: PointerEventInfo[] = [];
    const wheels: number[] = [];
    const keys: string[] = [];
    rig.input.on("pointermove", (e) => moves.push(e));
    rig.input.on("wheel", (e) => wheels.push(e.wheelDelta));
    rig.input.on("keydown", (e) => keys.push(e.code));

    rig.canvas.dispatch("pointerdown", pointer({ pointerId: 1, clientX: 110, clientY: 70 }));
    assert.equal(rig.input.pointerCount, 1);
    rig.canvas.dispatch("pointermove", pointer({ pointerId: 1, clientX: 130, clientY: 50 }));
    assert.equal(moves.length, 1);
    assert.equal(moves[0]!.deltaX, 20);
    assert.equal(moves[0]!.deltaY, -20);
    assert.deepEqual(pick(moves[0]!.ndc), { x: 0.2, y: 0.4 }, "移动后的 NDC（y 向上）");

    // 多指
    rig.canvas.dispatch("pointerdown", pointer({ pointerId: 2, clientX: 60, clientY: 70 }));
    assert.equal(rig.input.pointerCount, 2);
    rig.canvas.dispatch("pointerup", pointer({ pointerId: 2, clientX: 60, clientY: 70 }));
    assert.equal(rig.input.pointerCount, 1);

    rig.canvas.dispatch("wheel", pointer({ pointerId: 1, clientX: 110, clientY: 70, deltaY: -120 }));
    assert.deepEqual(wheels, [-120]);

    rig.win.dispatch("keydown", keyboard("KeyW"));
    rig.win.dispatch("keydown", keyboard("ShiftLeft", { shiftKey: true }));
    assert.deepEqual(keys, ["KeyW", "ShiftLeft"]);
    assert.equal(rig.input.isKeyDown("KeyW"), true);
    rig.win.dispatch("keyup", keyboard("KeyW"));
    assert.equal(rig.input.isKeyDown("KeyW"), false);
    // 失焦清空按键
    rig.win.dispatch("keydown", keyboard("KeyA"));
    assert.equal(rig.input.isKeyDown("KeyA"), true);
    rig.win.dispatch("blur", {});
    assert.equal(rig.input.isKeyDown("KeyA"), false);
  } finally {
    rig.restore();
  }
});

test("InputManager：click/dblclick 合成与阈值", () => {
  const rig = makeRig();
  try {
    let clicks = 0;
    let dbl = 0;
    rig.input.on("click", () => clicks++);
    rig.input.on("dblclick", () => dbl++);

    // 正常点击
    rig.canvas.dispatch("pointerdown", pointer({ clientX: 110, clientY: 70 }));
    rig.canvas.dispatch("pointerup", pointer({ clientX: 112, clientY: 71 }));
    assert.equal(clicks, 1);

    // 位移超过阈值（默认 6px）→ 不算点击
    rig.canvas.dispatch("pointerdown", pointer({ clientX: 110, clientY: 70 }));
    rig.canvas.dispatch("pointerup", pointer({ clientX: 140, clientY: 70 }));
    assert.equal(clicks, 1, "拖拽不应产生 click");

    // 两次快速点击 → dblclick
    rig.canvas.dispatch("pointerdown", pointer({ clientX: 110, clientY: 70 }));
    rig.canvas.dispatch("pointerup", pointer({ clientX: 110, clientY: 70 }));
    rig.canvas.dispatch("pointerdown", pointer({ clientX: 110, clientY: 70 }));
    rig.canvas.dispatch("pointerup", pointer({ clientX: 110, clientY: 70 }));
    assert.equal(clicks, 3);
    assert.equal(dbl, 1, "两次快速点击应合成 dblclick");
  } finally {
    rig.restore();
  }
});

test("InputManager：dispose 解绑全部监听且不再分发", () => {
  const rig = makeRig();
  const canvasCount = rig.canvas.count();
  const winCount = rig.win.count();
  assert.ok(canvasCount > 0 && winCount > 0, "构造时应绑定监听");

  let calls = 0;
  rig.input.on("pointermove", () => calls++);
  rig.input.dispose();
  assert.equal(rig.input.disposed, true);
  assert.equal(rig.canvas.count(), 0, "canvas 监听应全部移除");
  assert.equal(rig.win.count(), 0, "window 监听应全部移除");
  rig.canvas.dispatch("pointermove", pointer({ clientX: 1, clientY: 1 }));
  assert.equal(calls, 0, "dispose 后不再分发");
  (globalThis as { window?: unknown }).window = undefined;
});
