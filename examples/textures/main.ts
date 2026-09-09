/**
 * 纹理示例 —— 程序化棋盘格纹理 + 纹理材质 + 重复采样。
 */

import { bootDemo } from "../common/demo.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box, sphere, plane } from "../../src/render/primitives.js";
import { TextureMaterial } from "../../src/render/material.js";
import { Mesh } from "../../src/render/Mesh.js";
import { Color } from "../../src/math/color.js";
import { createCheckerTexture } from "../../src/render/texture.js";
import { degToRad } from "../../src/math/mmath.js";

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

    const textured = new TextureMaterial(device, new Color(1, 1, 1, 1), {
      label: "tex-material",
      sampler: { addressModeU: "repeat", addressModeV: "repeat" },
    });
    textured.setTexture(checker);

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

    let t = 0;
    const freeze = new URLSearchParams(location.search).get("freeze") !== null;
    return {
      frame(pass, ctx2) {
        if (!freeze) {
          t += ctx2.dt;
          ctx2.camera.yaw += ctx2.dt * 0.1;
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
