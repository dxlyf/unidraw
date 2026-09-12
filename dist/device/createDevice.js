/**
 * createDevice —— 设备工厂与后端探测。
 *
 * 用法：
 *   const device = await createDevice({ canvas, backend: "auto" });
 *   const mock   = createMockDevice();            // 无头测试
 *   const wgpu   = await createDevice({ canvas, backend: ["webgpu", "webgl2"] });
 */
import { WebGL2Device } from "./backend/webgl2/WebGL2Device.js";
import { isWebGPUSupported, WebGPUDevice } from "./backend/webgpu/WebGPUDevice.js";
import { MockDevice } from "./backend/mock/MockDevice.js";
import { UnidrawError } from "../util/assert.js";
import { logger } from "../util/logger.js";
function resolveOrder(pref, canvas) {
    if (pref === undefined || pref === "auto") {
        const order = ["webgpu", "webgl2"];
        if (!canvas)
            return ["mock"];
        return order;
    }
    if (typeof pref === "string")
        return [pref];
    return pref;
}
export async function createDevice(options = {}) {
    const { canvas, backend } = options;
    const order = resolveOrder(backend, canvas);
    const errors = [];
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
                    if (!isWebGPUSupported())
                        throw new UnidrawError("浏览器不支持 WebGPU（navigator.gpu 不存在）");
                    return await WebGPUDevice.create(canvas, options.webgpu);
                }
                case "webgl2": {
                    assertCanvas(canvas, kind);
                    return new WebGL2Device(canvas, options.webgl2);
                }
                default: {
                    const exhaustive = kind;
                    throw new UnidrawError(`未知后端：${String(exhaustive)}`);
                }
            }
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            logger.warn(`后端 ${kind} 初始化失败：${message}`);
            errors.push(`[${kind}] ${message}`);
        }
    }
    throw new UnidrawError(`所有候选后端均初始化失败：\n${errors.join("\n")}`);
}
export function createMockDevice() {
    return new MockDevice();
}
function assertCanvas(canvas, kind) {
    if (!canvas) {
        throw new UnidrawError(`后端 ${kind} 需要传入 HTMLCanvasElement（无头环境请使用 backend:"mock"）`);
    }
}
/** 探测本机支持情况（供 UI/文档使用）。 */
export function detectSupport() {
    return {
        webgl2: typeof WebGL2RenderingContext !== "undefined",
        webgpu: isWebGPUSupported(),
        mock: true,
    };
}
//# sourceMappingURL=createDevice.js.map