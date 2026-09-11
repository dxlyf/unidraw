import { bootDemo } from "../common/demo.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box, sphere, plane } from "../../src/render/primitives.js";
import { ColorMaterial } from "../../src/render/material.js";
import { Mesh } from "../../src/render/Mesh.js";
import { Color } from "../../src/math/color.js";
import { degToRad } from "../../src/math/mmath.js";
import { applyUrlOverrides, createGui } from "../common/gui.js";

/**
 * 形状示例：多几何体 + 深度测试 + 轨道相机 + 多材质。
 *
 * 右上角 lil-gui 面板可以实时调：物体数量、旋转速度、几何体（方块/球）、
 * 轨道小球开关、相机自转、地面显示。
 */
bootDemo({
  title: "形状 · 多个几何体（深度测试 / 轨道相机 / 多材质）",
  run(ctx) {
    const { device } = ctx;
    const params = new URLSearchParams(location.search);
    const state = {
      count: 6,
      spin: 1,
      shape: "mixed" as "mixed" | "box" | "sphere",
      orbiter: true,
      floor: true,
      autoRotate: true,
    };
    applyUrlOverrides(state, params);
    const gui = createGui({ title: "形状示例", params });

    const floorMaterial = new ColorMaterial(device, new Color(0.16, 0.17, 0.22, 1), { label: "floor" });
    const materials = [
      new ColorMaterial(device, new Color().setHex("#4c8dff"), { label: "blue" }),
      new ColorMaterial(device, new Color().setHex("#3dd68c"), { label: "green" }),
      new ColorMaterial(device, new Color().setHex("#ff8f3d"), { label: "orange" }),
      new ColorMaterial(device, new Color().setHex("#f5c518"), { label: "yellow" }),
      new ColorMaterial(device, new Color().setHex("#b07cff"), { label: "purple" }),
      new ColorMaterial(device, new Color().setHex("#ff5c8a"), { label: "pink" }),
    ];

    const boxGeo = Geometry.create(device, box());
    const sphereGeo = Geometry.create(device, sphere(0.9, 48, 24));
    const cubes: { mesh: Mesh; speed: number }[] = [];
    /** 按当前「几何体」选项重建物体（Mesh 只是几何 + 材质的适配器，重建很便宜） */
    function rebuildMeshes(): void {
      cubes.length = 0;
      for (let i = 0; i < 12; i++) {
        const useSphere = state.shape === "sphere" || (state.shape === "mixed" && i % 2 === 1);
        cubes.push({ mesh: new Mesh(useSphere ? sphereGeo : boxGeo), speed: 0.4 + i * 0.08 });
      }
    }
    rebuildMeshes();

    const floorGeo = Geometry.create(device, plane(14, 14, 1, 1));
    const floor = new Mesh(floorGeo);
    floor.model.setIdentity().translate(0, -3.6, 0).rotateX(degToRad(-90)).scale(1.6, 1.6, 1.6);

    const orbiterGeo = Geometry.create(device, sphere(0.28, 24, 12));
    const orbiter = new Mesh(orbiterGeo);

    let t = 0;

    // ---- 参数面板 -----------------------------------------------------------
    gui.add(state, "count", 1, 12, 1).name("物体数量");
    gui.add(state, "spin", 0, 3, 0.05).name("旋转速度");
    gui
      .add(state, "shape", { 混合: "mixed", 全部方块: "box", 全部球: "sphere" })
      .name("几何体")
      .onChange(rebuildMeshes);
    gui.add(state, "orbiter").name("轨道小球");
    gui.add(state, "floor").name("地面");
    gui.add(state, "autoRotate").name("相机自转");
    const resetYaw = (): void => {
      ctx.camera.yaw = 0;
      ctx.camera.update();
    };
    gui.add({ 重置视角: resetYaw }, "重置视角").name("重置视角");

    return {
      frame(pass, ctx2) {
        t += ctx2.dt * state.spin;
        const cam = ctx2.camera;
        cam.center.set(0, 0.2, 0);
        if (state.autoRotate) cam.yaw += ctx2.dt * 0.15;
        cam.update();

        const vp = cam.viewProjection;
        for (const m of materials) m.beginFrame(vp);
        floorMaterial.beginFrame(vp);

        // 地面
        if (state.floor) floorMaterial.draw(pass, floor);

        // 绕 Y 旋转的柱状形状
        const count = Math.min(state.count, cubes.length);
        for (let i = 0; i < count; i++) {
          const c = cubes[i]!;
          c.mesh.model.setIdentity().translate(0, i * 1.15 - 2.8, 0).rotateY(t * c.speed * 0.6).rotateX(degToRad(15));
          materials[i % materials.length]!.draw(pass, c.mesh);
        }

        // 环绕轨道小球
        if (state.orbiter) {
          orbiter.model.setIdentity().translate(Math.cos(t * 0.9) * 4.6, 1.6, Math.sin(t * 0.9) * 4.6).rotateY(t);
          materials[1]!.draw(pass, orbiter);
        }
      },
    };
  },
});
