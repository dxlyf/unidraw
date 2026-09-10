import { Texture, TextureView } from "../../../resources.js";
import type { TextureDescriptor, TextureUploadOptions } from "../../../descriptors.js";
import { assert } from "../../../../util/assert.js";
import { textureFormatInfo } from "../../../../gpu/formats.js";
import type { TextureFormat } from "../../../../gpu/types.js";
import type { GL } from "../glUtils.js";
import { GLTextureView } from "./GLTextureView.js";
import { WebGL2Device } from "../WebGL2Device.js";
import { nextId } from "../constants.js";
import { textureGLParams } from "../glUtils.js";

export class GLTexture extends Texture {
  readonly glTexture: WebGLTexture;
  readonly gl: GL;
  readonly id: number = nextId();
  /** 采样数（>1 时用多重采样 renderbuffer 作为附件，本对象只是标识/句柄） */
  readonly sampleCount: number;

  constructor(device: WebGL2Device, desc: TextureDescriptor) {
    super(desc);
    assert(desc.width >= 1 && desc.height >= 1, "纹理尺寸必须 >=1");
    this.gl = device.gl;
    this.sampleCount = Math.max(1, Math.floor(desc.sampleCount ?? 1));
    const tex = this.gl.createTexture();
    assert(tex, "createTexture 失败");
    this.glTexture = tex;
    if (this.sampleCount > 1) {
      // 多采样附件：真正的存储由 WebGL2Device 的 renderbuffer 缓存提供
      device.register(this);
      return;
    }
    this.bindScratch();
    const params = textureGLParams(this.gl, desc.format);
    if (GLTexture.isDepthFormatLocal(desc.format)) {
      this.gl.texStorage2D(this.gl.TEXTURE_2D, 1, params.internal, desc.width, desc.height);
    } else {
      this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
      this.gl.texImage2D(this.gl.TEXTURE_2D, 0, params.internal, desc.width, desc.height, 0, params.format, params.type, null);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    }
    device.register(this);
  }

  private static isDepthFormatLocal(format: TextureFormat): boolean {
    return format === "depth32float" || format === "depth24plus";
  }

  /** 内部绑定用纹理单元 0（layout 分配从 1 开始，永不冲突）。 */
  private bindScratch(): void {
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.glTexture);
  }

  protected override createDefaultView(): TextureView {
    return new GLTextureView(this);
  }

  override upload(data: ArrayBufferView, options: TextureUploadOptions = {}): void {
    assert(!GLTexture.isDepthFormatLocal(this.format), "深度纹理不支持 upload");
    const info = textureFormatInfo(this.format);
    const params = textureGLParams(this.gl, this.format);
    const x = options.x ?? 0;
    const y = options.y ?? 0;
    const width = options.width ?? this.width;
    const height = options.height ?? this.height;
    const bytesPerRow = options.bytesPerRow ?? width * info.bytesPerTexel;
    const bpp = info.bytesPerTexel;
    assert(width >= 1 && height >= 1 && x >= 0 && y >= 0, "upload 区域非法");
    assert(x + width <= this.width && y + height <= this.height, "upload 区域越界");
    assert(bytesPerRow % bpp === 0, "bytesPerRow 必须是纹素大小整数倍");
    const rowLength = bytesPerRow / bpp;

    this.bindScratch();
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    this.gl.pixelStorei(this.gl.UNPACK_ROW_LENGTH, rowLength);
    this.gl.pixelStorei(this.gl.UNPACK_SKIP_PIXELS, 0);
    this.gl.texSubImage2D(this.gl.TEXTURE_2D, options.mipLevel ?? 0, x, y, width, height, params.format, params.type, data);
    this.gl.pixelStorei(this.gl.UNPACK_ROW_LENGTH, 0);
  }

  override generateMipmaps(): void {
    this.bindScratch();
    this.gl.generateMipmap(this.gl.TEXTURE_2D);
  }

  protected destroyNative(): void {
    this.gl.deleteTexture(this.glTexture);
  }
}
