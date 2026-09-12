import { Buffer } from "../../../resources.js";
import type { BufferDescriptor } from "../../../descriptors.js";
import { MockDevice } from "../MockDevice.js";
export declare class MockBuffer extends Buffer {
    readonly data: Uint8Array;
    constructor(device: MockDevice, desc: BufferDescriptor);
    write(data: ArrayBufferView | ArrayBuffer, offset?: number): void;
    protected destroyNative(): void;
}
//# sourceMappingURL=MockBuffer.d.ts.map