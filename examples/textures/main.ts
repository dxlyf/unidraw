/**
 * 纹理示例 —— 程序化棋盘格纹理 + 纹理材质 + 重复采样。
 *
 * 右上角 lil-gui 面板：UV 寻址模式（repeat / clamp / mirror）、过滤方式（linear / nearest）、
 * 自动旋转与速度；`?gui=0` 关面板（无头回归用）。
 *
 * 注意：采样参数属于**材质构建选项**（sampler 在构造时创建、且参与 bind group），
 * 因此面板改动走 `onChange` → 用新 sampler 重建 TextureMaterial（带缓存，切回来复用）。
 *
 * 未提供的控件：
 * - **mipmap**：`createCheckerTexture` 只上传 base level，没有 mip 链；
 *   `Texture.generateMipmaps()` 在 WebGPU 后端是 no-op（见 `device/backend/webgpu/resources/WebGPUTexture.ts`），
 *   开启 `mips` 会变成「不完整纹理」（WebGL2 采样未定义）→ 跨后端不安全，省略；
 * - **各向异性**：`SamplerDescriptor.maxAnisotropy` 尚未接到 WebGL2/WebGPU 底层 API
 *   （见 docs/architecture.md）→ 省略。
 */

import { bootDemo } from "../common/demo.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box, sphere, plane } from "../../src/render/primitives.js";
import { TextureMaterial } from "../../src/render/material.js";
import { Mesh } from "../../src/render/Mesh.js";
import { Color } from "../../src/math/color.js";
import { createCheckerTexture } from "../../src/render/texture.js";
import { degToRad } from "../../src/math/mmath.js";
import { applyUrlOverrides, createGui } from "../common/gui.js";

const params = new URLSearchParams(location.search);

type AddressMode = "repeat" | "clamp-to-edge" | "mirror-repeat";
type FilterMode = "linear" | "nearest";

bootDemo({
  title: "纹理 · 棋盘格 + 重复寻址 + UV 贴图",
  run(ctx) {
    const { device } = ctx;

    // 纹理 A：彩色棋盘，repeat 寻址
    const checker = createCheckerTexture(device, {
      cell: 24,
      width: 256,
      height: 256,
      colorA: new Color().setHex("#2b3553"),
      colorB: new Color().setHex("#e8ecf5"),
      label: "checker",
    });
    // 纹理 B：低分辨率、nearest + clamp（像素风标签板）
    const coarse = createCheckerTexture(device, {
      cell: 8,
      width: 64,
      height: 64,
      colorA: new Color().setHex("#ff5c8a"),
      colorB: new Color().setHex("#12060c"),
      label: "coarse",
    });

    // ---- 参数（URL 可覆盖；面板实时改） --------------------------------------
    const state = {
      /** 棋盘材质 U 方向寻址 */
      addressU: "repeat" as AddressMode,
      /** 棋盘材质 V 方向寻址 */
      addressV: "repeat" as AddressMode,
      /** 放大/缩小过滤（棋盘是 256²，缩小时差异很明显） */
      filter: "linear" as FilterMode,
      /** 自动旋转（相机环绕 + 立方体自转） */
      autoRotate: true,
      /** 旋转速度倍率 */
      rotateSpeed: 1,
    };
    applyUrlOverrides(state, params);

    // 采样参数参与材质构建 → 按参数缓存，来回切换不重复建材质
    const materialCache = new Map<string, TextureMaterial>();
    function checkerMaterial(): TextureMaterial {
      const key = `${state.addressU}|${state.addressV}|${state.filter}`;
      const cached = materialCache.get(key);
      if (cached) return cached;
      const material = new TextureMaterial(device, new Color(1, 1, 1, 1), {
        label: `tex-material-${key}`,
        sampler: {
          addressModeU: state.addressU,
          addressModeV: state.addressV,
          magFilter: state.filter,
          minFilter: state.filter,
        },
      });
      material.setTexture(checker);
      materialCache.set(key, material);
      return material;
    }

    /** 棋盘材质（地板 + 立方体）——采样参数变化时在 onChange 里换掉 */
    let textured = checkerMaterial();

    const pixel = new TextureMaterial(device, new Color(1, 0.92, 0.9, 1), {
      label: "pixel-material",
      sampler: { magFilter: "nearest", minFilter: "nearest", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" },
    });
    pixel.setTexture(coarse);

    // 旋转立方体观察棋盘纹理
    const cubeMesh = new Mesh(Geometry.create(device, box(2.6, 2.6, 2.6)));
    // 地板：repeat 采样，铺 6x6 块
    const floorMesh = new Mesh(Geometry.create(device, plane(24, 24, 1, 1, 6, 6)));
    floorMesh.model.setIdentity().rotateX(degToRad(-90)).translate(0, -1.7, 0);
    // 像素标签球
    const ballMesh = new Mesh(Geometry.create(device, sphere(1.1, 48, 32)));
    ballMesh.model.setIdentity().translate(3.2, 0.6, 0);

    // ---- 参数面板（lil-gui）：左上角是 HUD，面板在右上角 ----------------------
    const gui = createGui({ title: "纹理采样", params });
    gui
      .add(state, "addressU", { 重复: "repeat", 钳制到边缘: "clamp-to-edge", 镜像重复: "mirror-repeat" })
      .name("U 寻址")
      .onChange(applySampler);
    gui
      .add(state, "addressV", { 重复: "repeat", 钳制到边缘: "clamp-to-edge", 镜像重复: "mirror-repeat" })
      .name("V 寻址")
      .onChange(applySampler);
    gui.add(state, "filter", { 双线性: "linear", 最近邻: "nearest" }).name("过滤方式").onChange(applySampler);
    gui.add(state, "autoRotate").name("自动旋转");
    gui.add(state, "rotateSpeed", 0, 3, 0.05).name("旋转速度");

    /** 采样参数变了 → 换成对应 sampler 的材质（帧循环持有的是本变量） */
    function applySampler(): void {
      textured = checkerMaterial();
    }

    const hud = document.querySelector<HTMLElement>(".hud");
    if (hud) {
      const line = document.createElement("div");
      line.textContent = "面板      : 右上角 lil-gui 可调（?gui=0 关面板）";
      hud.appendChild(line);
    }

    let t = 0;
    const freeze = params.get("freeze") !== null;
    return {
      frame(pass, ctx2) {
        if (!freeze) {
          if (state.autoRotate) {
            t += ctx2.dt * state.rotateSpeed;
            ctx2.camera.yaw += ctx2.dt * 0.1 * state.rotateSpeed;
          }
        } else {
          t = 1.8;
        }
        const cam = ctx2.camera;
        cam.update();
        const vp = cam.viewProjection;

        textured.beginFrame(vp);
        pixel.beginFrame(vp);

        // 地板
        floorMesh.model.setIdentity().rotateX(degToRad(-90)).translate(0, -1.7, 0);
        textured.draw(pass, floorMesh);

        // 旋转立方体
        cubeMesh.model.setIdentity().translate(0, 0.6, 0).rotateY(t * 0.6).rotateX(0.2);
        textured.draw(pass, cubeMesh);

        // 像素风球
        ballMesh.model.setIdentity().translate(3.4, 0.5, 0).rotateY(-t * 0.9);
        pixel.draw(pass, ballMesh);
      },
    };
  },
});
