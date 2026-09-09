import { bootDemo } from "../common/demo.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box, sphere, plane } from "../../src/render/primitives.js";
import { ColorMaterial } from "../../src/render/material.js";
import { Mesh } from "../../src/render/Mesh.js";
import { Color } from "../../src/math/color.js";
import { degToRad } from "../../src/math/mmath.js";

bootDemo({
  title: "形状 · 多个几何体（深度测试 / 轨道相机 / 多材质）",
  run(ctx) {
    const { device } = ctx;
    const floorMaterial = new ColorMaterial(device, new Color(0.16, 0.17, 0.22, 1), { label: "floor" });
    const materials = [
      new ColorMaterial(device, new Color().setHex("#4c8dff"), { label: "blue" }),
      new ColorMaterial(device, new Color().setHex("#3dd68c"), { label: "green" }),
      new ColorMaterial(device, new Color().setHex("#ff8f3d"), { label: "orange" }),
      new ColorMaterial(device, new Color().setHex("#f5c518"), { label: "yellow" }),
      new ColorMaterial(device, new Color().setHex("#b07cff"), { label: "purple" }),
      new ColorMaterial(device, new Color().setHex("#ff5c8a"), { label: "pink" }),
    ];

    const cubes: { mesh: Mesh; speed: number }[] = [];
    const boxGeo = Geometry.create(device, box());
    const sphereGeo = Geometry.create(device, sphere(0.9, 48, 24));
    for (let i = 0; i < 6; i++) {
      const useSphere = i % 2 === 1;
      const mesh = new Mesh(useSphere ? sphereGeo : boxGeo);
      mesh.model.setIdentity().translate(0, i * 1.15 - 2.8, 0);
      cubes.push({ mesh, speed: 0.4 + i * 0.13 });
    }

    const floorGeo = Geometry.create(device, plane(14, 14, 1, 1));
    const floor = new Mesh(floorGeo);
    floor.model.setIdentity().translate(0, -3.6, 0).rotateX(degToRad(-90)).scale(1.6, 1.6, 1.6);

    const orbiterGeo = Geometry.create(device, sphere(0.28, 24, 12));
    const orbiter = new Mesh(orbiterGeo);

    let t = 0;
    return {
      frame(pass, ctx2) {
        t += ctx2.dt;
        const cam = ctx2.camera;
        cam.center.set(0, 0.2, 0);
        cam.yaw += ctx2.dt * 0.15;
        cam.update();

        const vp = cam.viewProjection;
        for (const m of materials) m.beginFrame(vp);
        floorMaterial.beginFrame(vp);

        // 地面
        floorMaterial.draw(pass, floor);

        // 绕 Y 旋转的柱状形状
        cubes.forEach((c, i) => {
          c.mesh.model.setIdentity().translate(0, i * 1.15 - 2.8, 0).rotateY(t * c.speed * 0.6).rotateX(degToRad(15));
          materials[i % materials.length]!.draw(pass, c.mesh);
        });

        // 环绕轨道小球
        orbiter.model.setIdentity().translate(Math.cos(t * 0.9) * 4.6, 1.6, Math.sin(t * 0.9) * 4.6).rotateY(t);
        materials[1]!.draw(pass, orbiter);
      },
    };
  },
});
