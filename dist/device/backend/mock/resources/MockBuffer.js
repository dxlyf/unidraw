import { Buffer } from "../../../resources.js";
import { assert } from "../../../../util/assert.js";
// ---------------------------------------------------------------------------
// Mock 资源
// ---------------------------------------------------------------------------
export class MockBuffer extends Buffer {
    data;
    constructor(device, desc) {
        super(desc);
        assert(desc.size >= 0, "Buffer size 不能为负");
        this.data = new Uint8Array(desc.size);
        device.register(this);
    }
    write(data, offset = 0) {
        assert(offset >= 0 && offset <= this.data.byteLength, "write offset 非法");
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        assert(offset + bytes.byteLength <= this.data.byteLength, `Buffer 写入越界: offset=${offset} len=${bytes.byteLength} size=${this.size}`);
        this.data.set(bytes, offset);
    }
    destroyNative() { }
}
//# sourceMappingURL=MockBuffer.js.map