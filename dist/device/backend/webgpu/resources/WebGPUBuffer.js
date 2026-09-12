import { Buffer } from "../../../resources.js";
import { assert } from "../../../../util/assert.js";
import { align4, mapBufferUsage } from "../gpuUtils.js";
export class WebGPUBuffer extends Buffer {
    gpuBuffer;
    _device;
    constructor(device, desc) {
        super(desc);
        assert(desc.size >= 0, "Buffer size 不能为负");
        this._device = device;
        // WebGPU 要求 buffer size 为 4 的倍数
        this.gpuBuffer = device.gpu.createBuffer({ label: desc.label, size: align4(desc.size), usage: mapBufferUsage(desc.usage) });
        device.register(this);
    }
    write(data, offset = 0) {
        assert(offset >= 0, "write offset 不能为负");
        assert(offset % 4 === 0, "WebGPU writeBuffer 的 buffer 偏移必须是 4 的倍数");
        const bytes = data instanceof ArrayBuffer ? data : data.buffer;
        const byteOffset = data instanceof ArrayBuffer ? 0 : data.byteOffset;
        const byteLength = data instanceof ArrayBuffer ? data.byteLength : data.byteLength;
        // writeBuffer 的写入字节数也必须是 4 的倍数；不足时补零到 4 的倍数
        if (byteLength % 4 !== 0) {
            const padded = new Uint8Array(align4(byteLength));
            padded.set(new Uint8Array(bytes, byteOffset, byteLength));
            this._device.gpu.queue.writeBuffer(this.gpuBuffer, offset, padded.buffer, 0, padded.byteLength);
            return;
        }
        this._device.gpu.queue.writeBuffer(this.gpuBuffer, offset, bytes, byteOffset, byteLength);
    }
    destroyNative() {
        this.gpuBuffer.destroy();
    }
}
//# sourceMappingURL=WebGPUBuffer.js.map