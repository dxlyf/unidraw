/**
 * 3D 材质与几何画廊
 *
 * 展示几何：立方体/球体/圆柱/圆锥/圆环/胶囊/平面
 * 展示材质：Unlit(纯色) / Lambert(ColorMaterial) / Phong(高光) / 纹理
 */

import { bootDemo } from "../common/demo.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box, sphere, cylinder, cone, torus, capsule, plane } from "../../src/render/primitives.js";
import { ColorMaterial, UnlitColorMaterial, PhongMaterial, TextureMaterial } from "../../src/render/material.js";
import { Mesh } from "../../src/render/Mesh.js";
import { createCheckerTexture } from "../../src/render/texture.js";
import { Color } from "../../src/math/color.js";
import { degToRad } from "../../src/math/mmath.js";
import type { Device } from "../../src/device/Device.js";
import type { RenderPassEncoder } from "../../src/command/encoder.js";

type Material = ColorMaterial | UnlitColorMaterial | PhongMaterial | TextureMaterial;

interface Item {
  mesh: Mesh;
  material: Material;
  base: [number, number, number];
  spinAxis: "x" | "y";
  spinSpeed: number;
  scale: number;
}

bootDemo({
  title: "3D · 材质与几何画廊",
  run(ctx) {
    const device: Device = ctx.device;
    const items: Item[] = [];

    const make = (builder: () => ReturnType<typeof box>, material: Material, at: [number, number, number], axis: "x" | "y", scale = 1, speed = 1): void => {
      const mesh = new Mesh(Geometry.create(device, builder()));
      items.push({ mesh, material, base: at, spinAxis: axis, spinSpeed: speed, scale });
    };

    const R = 2.6;
    const slot = (i: number): [number, number, number] => {
      const a = -Math.PI / 2 + (i / 6) * Math.PI * 2;
      return [Math.cos(a) * R, 0.4 + Math.sin(a) * 0.2, Math.sin(a) * R];
    };

    const unlit = new UnlitColorMaterial(device, new Color().setHex("#ff5c7a"), { label: "unlit" });
    const colorM = new ColorMaterial(device, new Color().setHex("#5aa0ff"), { label: "lambert" });
    const phong = new PhongMaterial(device, new Color().setHex("#ff9a3d"), { label: "phong", shininess: 120, specular: 1, ambient: 0.16 });
    const phongCyan = new PhongMaterial(device, new Color().setHex("#22d3ee"), { label: "phong-cyl", shininess: 24, specular: 0.6, ambient: 0.2 });
    const checker = createCheckerTexture(device, { cell: 12, colorA: new Color().setHex("#20273a"), colorB: new Color().setHex("#c9d6ea"), label: "tex3d" });
    const textured = new TextureMaterial(device, new Color(1, 1, 1, 1), { sampler: { addressModeU: "repeat", addressModeV: "repeat" } });
    textured.setTexture(checker);

    make(() => box(1.1, 1.1, 1.1), unlit, slot(0), "y", 1, 0.8); // 立方体 · Unlit
    make(() => sphere(0.75, 48, 32), colorM, slot(1), "x", 1); // 球体 · Lambert
    make(() => torus(0.55, 0.2, 40, 18), phong, slot(2), "x", 1); // 圆环 · Phong
    make(() => cylinder(0.5, 0.5, 1.1, 40, 1), phongCyan, slot(3), "y", 1); // 圆柱 · Phong
    make(() => cone(0.6, 1.2, 40), colorM, slot(4), "y", 1, 0.6); // 圆锥 · Lambert
    make(() => capsule(0.45, 0.8, 32, 10), textured, slot(5), "y", 1, 0.7); // 胶囊 · 纹理
    make(() => sphere(0.42, 40, 28), phong, [0, 0.35, 0], "y", 1, 1.4); // 中心高光球

    const floorMesh = new Mesh(Geometry.create(device, plane(9, 9, 1, 1, 5, 5)));
    floorMesh.model.setIdentity().rotateX(degToRad(-90)).translate(0, -0.95, 0);
    const floor = new UnlitColorMaterial(device, new Color(0.1, 0.11, 0.15, 1), { label: "floor3d" });

    let t = 0;
    return {
      frame(pass: RenderPassEncoder, ctx2) {
        t += ctx2.dt;
        const cam = ctx2.camera;
        cam.center.set(0, 0.15, 0);
        cam.distance = 7.4;
        cam.pitch = -0.15;
        cam.yaw += ctx2.dt * 0.12;
        cam.update();
        const vp = cam.viewProjection;
        const eye = cam.eyePosition;

        // 统一 beginFrame
        const mats = new Set<Material>([...items.map((i) => i.material), floor]);
        for (const m of mats) m.beginFrame(vp, eye);
        floor.draw(pass, floorMesh);

        items.forEach((it) => {
          const m = it.mesh.model;
          m.setIdentity().translate(it.base[0], it.base[1], it.base[2]).scale(it.scale, it.scale, it.scale);
          const ang = t * it.spinSpeed;
          if (it.spinAxis === "x") m.rotateX(ang);
          else m.rotateY(ang);
          it.material.draw(pass, it.mesh);
        });
      },
    };
  },
});
