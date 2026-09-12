/**
 * createDevice —— 设备工厂与后端探测。
 *
 * 用法：
 *   const device = await createDevice({ canvas, backend: "auto" });
 *   const mock   = createMockDevice();            // 无头测试
 *   const wgpu   = await createDevice({ canvas, backend: ["webgpu", "webgl2"] });
 */
import { Device } from "./Device.js";
import { type WebGPUDeviceOptions } from "./backend/webgpu/WebGPUDevice.js";
import { MockDevice } from "./backend/mock/MockDevice.js";
import type { BackendPreference } from "../gpu/types.js";
export interface CreateDeviceOptions {
    /** webgpu/webgl2 必须提供；mock 可省略 */
    canvas?: HTMLCanvasElement;
    /** 后端偏好，默认 "auto"（webgpu → webgl2） */
    backend?: BackendPreference;
    /** WebGL2 上下文选项 */
    webgl2?: {
        antialias?: boolean;
        alpha?: boolean;
    };
    /** WebGPU 选项 */
    webgpu?: WebGPUDeviceOptions;
}
export declare function createDevice(options?: CreateDeviceOptions): Promise<Device>;
export declare function createMockDevice(): MockDevice;
/** 探测本机支持情况（供 UI/文档使用）。 */
export declare function detectSupport(): {
    webgl2: boolean;
    webgpu: boolean;
    mock: boolean;
};
//# sourceMappingURL=createDevice.d.ts.map