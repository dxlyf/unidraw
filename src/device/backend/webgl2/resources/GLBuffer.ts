import { Buffer } from "../../../resources.js";
import type { BufferDescriptor } from "../../../descriptors.js";
import { assert } from "../../../../util/assert.js";
import type { GL } from "../glUtils.js";
import { WebGL2Device } from "../WebGL2Device.js";
import { bufferTarget, bufferUsageHint } from "../glUtils.js";
import { nextId } from "../constants.js";


// ---------------------------------------------------------------------------
// WebGL2 资源
// ---------------------------------------------------------------------------
export class GLBuffer extends Buffer {
  readonly glBuffer: WebGLBuffer;
  readonly gl: GL;
  readonly id: number = nextId();
  private readonly _target: number;

  constructor(device: WebGL2Device, desc: BufferDescriptor) {
    super(desc);
    assert(desc.size >= 0, "Buffer size 不能为负");
    this.gl = device.gl;
    this._target = bufferTarget(desc.usage);
    const buf = this.gl.createBuffer();
    assert(buf, "createBuffer 失败");
    this.glBuffer = buf;
    this.gl.bindBuffer(this._target, buf);
    this.gl.bufferData(this._target, desc.size, bufferUsageHint(desc.usage));
    device.register(this);
  }

  override write(data: ArrayBufferView | ArrayBuffer, offset = 0): void {
    assert(offset >= 0, "write offset 不能为负");
    this.gl.bindBuffer(this._target, this.glBuffer);
    this.gl.bufferSubData(this._target, offset, data);
  }

  protected destroyNative(): void {
    this.gl.deleteBuffer(this.glBuffer);
  }
}
