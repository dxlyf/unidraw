import { Texture } from "../../../resources.js";
import { assert } from "../../../../util/assert.js";
import { textureFormatInfo } from "../../../../gpu/formats.js";
import { GLTextureView } from "./GLTextureView.js";
import { nextId } from "../constants.js";
import { textureGLParams } from "../glUtils.js";
export class GLTexture extends Texture {
    glTexture;
    gl;
    id = nextId();
    /** GL 纹理目标（由 dimension 决定：2D / 3D / 2D_ARRAY / CUBE_MAP） */
    _target;
    _device;
    /**
     * 是否被当作渲染附件写过（颜色或深度）。
     *
     * GL 的行序与「页面上下」相反：光栅化把画面顶部写到最后一行，而 `upload()` 的
     * 第 0 行落在内存第 0 行。于是回读时**只有渲染出来的纹理需要翻转 Y**
     * （详见 `WebGL2Device.readTexturePixels` 的说明）。
     */
    usedAsAttachment = false;
    constructor(device, desc) {
        super(desc);
        assert(desc.width >= 1 && desc.height >= 1, "纹理尺寸必须 >=1");
        this._device = device;
        this.gl = device.gl;
        this._target =
            this.dimension === "3d"
                ? device.gl.TEXTURE_3D
                : this.dimension === "2d-array"
                    ? device.gl.TEXTURE_2D_ARRAY
                    : this.dimension === "cube"
                        ? device.gl.TEXTURE_CUBE_MAP
                        : device.gl.TEXTURE_2D;
        const tex = this.gl.createTexture();
        assert(tex, "createTexture 失败");
        this.glTexture = tex;
        if (this.sampleCount > 1) {
            // 多采样附件：真正的存储由 WebGL2Device 的 renderbuffer 缓存提供
            device.register(this);
            return;
        }
        this.bindScratch();
        const gl = this.gl;
        const params = textureGLParams(gl, desc.format);
        const layers = this.depthOrArrayLayers;
        const immutable = GLTexture.isDepthFormatLocal(desc.format) || this.dimension === "cube";
        // cube 必须用不可变存储（texStorage2D 会一次分配 6 个面；逐面 texImage2D 要给
        // TEXTURE_CUBE_MAP_POSITIVE_X+i，用整个 CUBE_MAP 目标是非法枚举）
        if (immutable) {
            if (this.dimension === "2d")
                gl.texStorage2D(gl.TEXTURE_2D, 1, params.internal, desc.width, desc.height);
            else if (this.dimension === "cube")
                gl.texStorage2D(gl.TEXTURE_CUBE_MAP, 1, params.internal, desc.width, desc.height);
            else
                gl.texStorage3D(this._target, 1, params.internal, desc.width, desc.height, layers);
        }
        else {
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            if (this.dimension === "2d")
                gl.texImage2D(gl.TEXTURE_2D, 0, params.internal, desc.width, desc.height, 0, params.format, params.type, null);
            else
                gl.texImage3D(this._target, 0, params.internal, desc.width, desc.height, layers, 0, params.format, params.type, null);
        }
        // 深度纹理也要显式设成 NEAREST/CLAMP：默认的 NEAREST_MIPMAP_LINEAR 在
        // 「无 mip 链 + 未绑定 sampler 对象」时属于**不完整纹理**（采样恒为 (0,0,0,1)），
        // 阴影贴图这类「纹理自带采样参数」的用法会直接读到全 1 → 阴影完全失效。
        gl.texParameteri(this._target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(this._target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(this._target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(this._target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (this.dimension === "3d" || this.dimension === "2d-array")
            gl.texParameteri(this._target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        device.register(this);
    }
    static isDepthFormatLocal(format) {
        return format === "depth32float" || format === "depth24plus";
    }
    /** 内部绑定用纹理单元 0（layout 分配从 1 开始，永不冲突）。 */
    bindScratch() {
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this._target, this.glTexture);
    }
    createDefaultView() {
        return new GLTextureView(this);
    }
    createLayerView(baseArrayLayer, mipLevel) {
        return new GLTextureView(this, baseArrayLayer, 1, mipLevel);
    }
    upload(data, options = {}) {
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
        const gl = this.gl;
        const mip = options.mipLevel ?? 0;
        const z = Math.max(0, Math.floor(options.z ?? 0));
        const depth = Math.max(1, Math.floor(options.depth ?? 1));
        this.bindScratch();
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, rowLength);
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
        gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, 0);
        if (this.dimension === "3d" || this.dimension === "2d-array") {
            // 每层步长：给了 bytesPerImage 就按它（层间可能有 padding），否则紧密排列
            const imageRows = options.bytesPerImage !== undefined ? Math.round(options.bytesPerImage / bytesPerRow) : height;
            gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, imageRows);
            gl.texSubImage3D(this._target, mip, x, y, z, width, height, depth, params.format, params.type, data);
            gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
        }
        else if (this.dimension === "cube") {
            gl.texSubImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + z, mip, x, y, width, height, params.format, params.type, data);
        }
        else {
            gl.texSubImage2D(gl.TEXTURE_2D, mip, x, y, width, height, params.format, params.type, data);
        }
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    }
    generateMipmaps() {
        this.bindScratch();
        this.gl.generateMipmap(this.gl.TEXTURE_2D);
    }
    destroyNative() {
        this.gl.deleteTexture(this.glTexture);
        // MSAA attachment 用的 renderbuffer / FBO 是按纹理身份缓存的，纹理没了要一起回收
        this._device.releaseMsaaResources(this.id);
    }
}
//# sourceMappingURL=GLTexture.js.map