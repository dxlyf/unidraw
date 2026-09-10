import { Buffer } from "../../../resources.js";
import type { BufferDescriptor } from "../../../descriptors.js";
import { assert } from "../../../../util/assert.js";
import { MockDevice } from "../MockDevice.js";


// ---------------------------------------------------------------------------
// Mock 资源
// ---------------------------------------------------------------------------
export class MockBuffer extends Buffer {
  readonly data: Uint8Array;

  constructor(device: MockDevice, desc: BufferDescriptor) {
    super(desc);
    assert(desc.size >= 0, "Buffer size 不能为负");
    this.data = new Uint8Array(desc.size);
    device.register(this);
  }

  override write(data: ArrayBufferView | ArrayBuffer, offset = 0): void {
    assert(offset >= 0 && offset <= this.data.byteLength, "write offset 非法");
    const bytes =
      data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    assert(offset + bytes.byteLength <= this.data.byteLength, `Buffer 写入越界: offset=${offset} len=${bytes.byteLength} size=${this.size}`);
    this.data.set(bytes, offset);
  }

  protected destroyNative(): void {}
}
