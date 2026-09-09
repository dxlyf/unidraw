/**
 * createDevice —— 设备工厂与后端探测。
 *
 * 用法：
 *   const device = await createDevice({ canvas, backend: "auto" });
 *   const mock   = createMockDevice();            // 无头测试
 *   const wgpu   = await createDevice({ canvas, backend: ["webgpu", "webgl2"] });
 */

import { Device } from "./Device.js";
import { WebGL2Device } from "./backend/webgl2/WebGL2Device.js";
import { isWebGPUSupported, WebGPUDevice, type WebGPUDeviceOptions } from "./backend/webgpu/WebGPUDevice.js";
import { MockDevice } from "./backend/mock/MockDevice.js";
import { UnidrawError } from "../util/assert.js";
import { logger } from "../util/logger.js";
import type { BackendKind, BackendPreference } from "../gpu/types.js";

export interface CreateDeviceOptions {
  /** webgpu/webgl2 必须提供；mock 可省略 */
  canvas?: HTMLCanvasElement;
  /** 后端偏好，默认 "auto"（webgpu → webgl2） */
  backend?: BackendPreference;
  /** WebGL2 上下文选项 */
  webgl2?: { antialias?: boolean; alpha?: boolean };
  /** WebGPU 选项 */
  webgpu?: WebGPUDeviceOptions;
}

function resolveOrder(pref: BackendPreference | undefined, canvas?: HTMLCanvasElement): BackendKind[] {
  if (pref === undefined || pref === "auto") {
    const order: BackendKind[] = ["webgpu", "webgl2"];
    if (!canvas) return ["mock"];
    return order;
  }
  if (typeof pref === "string") return [pref];
  return pref;
}

export async function createDevice(options: CreateDeviceOptions = {}): Promise<Device> {
  const { canvas, backend } = options;
  const order = resolveOrder(backend, canvas);
  const errors: string[] = [];

  for (const kind of order) {
    try {
      switch (kind) {
        case "mock":
          if (canvas !== undefined) {
            logger.warn("createDevice(mock) 忽略 canvas 参数");
          }
          return createMockDevice();
        case "webgpu": {
          assertCanvas(canvas, kind);
          if (!isWebGPUSupported()) throw new UnidrawError("浏览器不支持 WebGPU（navigator.gpu 不存在）");
          return await WebGPUDevice.create(canvas!, options.webgpu);
        }
        case "webgl2": {
          assertCanvas(canvas, kind);
          return new WebGL2Device(canvas!, options.webgl2);
        }
        default: {
          const exhaustive: never = kind;
          throw new UnidrawError(`未知后端：${String(exhaustive)}`);
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.warn(`后端 ${kind} 初始化失败：${message}`);
      errors.push(`[${kind}] ${message}`);
    }
  }
  throw new UnidrawError(`所有候选后端均初始化失败：\n${errors.join("\n")}`);
}

export function createMockDevice(): MockDevice {
  return new MockDevice();
}

function assertCanvas(canvas: HTMLCanvasElement | undefined, kind: BackendKind): void {
  if (!canvas) {
    throw new UnidrawError(`后端 ${kind} 需要传入 HTMLCanvasElement（无头环境请使用 backend:"mock"）`);
  }
}

/** 探测本机支持情况（供 UI/文档使用）。 */
export function detectSupport(): { webgl2: boolean; webgpu: boolean; mock: boolean } {
  return {
    webgl2: typeof WebGL2RenderingContext !== "undefined",
    webgpu: isWebGPUSupported(),
    mock: true,
  };
}
