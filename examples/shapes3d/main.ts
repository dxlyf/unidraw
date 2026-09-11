/**
 * 3D 材质与几何画廊
 *
 * 展示几何：立方体/球体/圆柱/圆锥/圆环/胶囊/平面
 * 展示材质：Unlit(纯色) / Lambert(ColorMaterial) / Phong(高光) / 纹理
 *
 * 右上角 lil-gui 面板：几何体切换、材质切换（重建 Mesh / 换材质对象）、光照强度
 * （缩放框架默认光：环境 0.35 + 方向光 0.65）、物体自转、相机环绕、旋转速度；
 * `?gui=0` 关面板（无头回归用）。
 */

import { bootDemo } from "../common/demo.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box, sphere, cylinder, cone, torus, capsule, plane } from "../../src/render/primitives.js";
import { ColorMaterial, UnlitColorMaterial, PhongMaterial, TextureMaterial } from "../../src/render/material.js";
import { Mesh } from "../../src/render/Mesh.js";
import { createCheckerTexture } from "../../src/render/texture.js";
import { Color } from "../../src/math/color.js";
import { Vec3 } from "../../src/math/vec3.js";
import { degToRad } from "../../src/math/mmath.js";
import { LightsState } from "../../src/render/lights/index.js";
import { addButtons, applyUrlOverrides, createGui } from "../common/gui.js";
import type { Device } from "../../src/device/Device.js";
import type { RenderPassEncoder } from "../../src/command/encoder.js";

type Material = ColorMaterial | UnlitColorMaterial | PhongMaterial | TextureMaterial;
/** 图元建造函数返回的几何体数据（与 primitives 的返回值一致） */
type GeoData = ReturnType<typeof box>;

interface Item {
  mesh: Mesh;
  material: Material;
  /** 「按原样」时该槽位原本的材质 / 几何体（面板切回来要能还原） */
  defaultMaterial: Material;
  defaultGeometry: () => GeoData;
  base: [number, number, number];
  spinAxis: "x" | "y";
  spinSpeed: number;
  scale: number;
}

const params = new URLSearchParams(location.search);

bootDemo({
  title: "3D · 材质与几何画廊",
  run(ctx) {
    const device: Device = ctx.device;
    const items: Item[] = [];

    const make = (builder: () => GeoData, material: Material, at: [number, number, number], axis: "x" | "y", scale = 1, speed = 1): void => {
      const mesh = new Mesh(Geometry.create(device, builder()));
      items.push({
        mesh,
        material,
        defaultMaterial: material,
        defaultGeometry: builder,
        base: at,
        spinAxis: axis,
        spinSpeed: speed,
        scale,
      });
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

    // ---- 参数（URL 可覆盖；面板实时改） --------------------------------------
    /** 面板可切的几何体（「按原样」= 每个槽位原本的几何体） */
    const geometryBuilders: Record<string, () => GeoData> = {
      box: () => box(1.1, 1.1, 1.1),
      sphere: () => sphere(0.75, 48, 32),
      torus: () => torus(0.55, 0.2, 40, 18),
      cylinder: () => cylinder(0.5, 0.5, 1.1, 40, 1),
      cone: () => cone(0.6, 1.2, 40),
      capsule: () => capsule(0.45, 0.8, 32, 10),
      plane: () => plane(1.4, 1.4, 1, 1),
    };
    /** 面板可切的材质（「按原样」= 每个槽位原本的材质） */
    const materialChoices: Record<string, Material> = {
      unlit,
      lambert: colorM,
      phong,
      texture: textured,
    };

    const state = {
      /** 几何体：default = 各槽位原样 */
      geometry: "default" as string,
      /** 材质：default = 各槽位原样 */
      material: "default" as string,
      /** 物体自转 */
      objectSpin: true,
      /** 相机环绕 */
      autoOrbit: true,
      /** 旋转速度倍率 */
      spinSpeed: 1,
      /** 光照强度（缩放框架默认光：环境 0.35 + 方向光 0.65） */
      lightIntensity: 1,
    };
    applyUrlOverrides(state, params);

    // 默认光由 LightsState 显式打包（与「场景里没有灯」时的默认光严格一致）
    const lights = new LightsState();
    const WHITE = new Color(1, 1, 1, 1);
    function applyLights(): void {
      lights.reset();
      lights.addAmbient(WHITE, 0.35 * state.lightIntensity);
      lights.addDirectional(new Vec3(-0.35, -0.75, -0.55), WHITE, 0.65 * state.lightIntensity);
      lights.finish();
    }
    applyLights();

    /** 换材质：只替换材质对象（不需要重建 GPU 资源） */
    function applyMaterial(): void {
      const override = materialChoices[state.material];
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        it.material = override ?? it.defaultMaterial;
        it.mesh.material = it.material;
      }
    }

    /** 换几何体：几何体是 GPU 资源 → 在 onChange 里重建 Mesh 并释放旧几何体 */
    function applyGeometry(): void {
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        const builder = state.geometry === "default" ? it.defaultGeometry : geometryBuilders[state.geometry] ?? it.defaultGeometry;
        const mesh = new Mesh(Geometry.create(device, builder()), it.material);
        it.mesh.geometry.destroy();
        mesh.model = it.mesh.model;
        it.mesh = mesh;
      }
    }

    // ---- 参数面板（lil-gui）：左上角是 HUD，面板在右上角 ----------------------
    const gui = createGui({ title: "3D 材质与几何", params });
    gui
      .add(state, "geometry", {
        按原样: "default",
        立方体: "box",
        球体: "sphere",
        圆环: "torus",
        圆柱: "cylinder",
        圆锥: "cone",
        胶囊: "capsule",
        平面: "plane",
      })
      .name("几何体")
      .onChange(() => {
        applyGeometry();
        syncControllers();
      });
    gui
      .add(state, "material", {
        按原样: "default",
        "Unlit 纯色": "unlit",
        "Lambert 漫反射": "lambert",
        "Phong 高光": "phong",
        棋盘纹理: "texture",
      })
      .name("材质")
      .onChange(() => {
        applyMaterial();
        syncControllers();
      });
    gui.add(state, "lightIntensity", 0, 2, 0.01).name("光照强度").onChange(applyLights);
    gui.add(state, "objectSpin").name("物体自转");
    gui.add(state, "autoOrbit").name("相机环绕");
    gui.add(state, "spinSpeed", 0, 3, 0.05).name("旋转速度");
    addButtons(gui, "操作", {
      恢复默认: () => {
        state.geometry = "default";
        state.material = "default";
        state.lightIntensity = 1;
        state.objectSpin = true;
        state.autoOrbit = true;
        state.spinSpeed = 1;
        applyGeometry();
        applyMaterial();
        applyLights();
        syncControllers();
      },
    });

    /** 状态被键盘/按钮改了以后，把面板显示刷新到最新值 */
    function syncControllers(): void {
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    }

    const hud = document.querySelector<HTMLElement>(".hud");
    if (hud) {
      const line = document.createElement("div");
      line.textContent = "面板      : 右上角 lil-gui 可调（?gui=0 关面板）";
      hud.appendChild(line);
    }

    let t = 0;
    return {
      frame(pass: RenderPassEncoder, ctx2) {
        t += ctx2.dt;
        const cam = ctx2.camera;
        cam.center.set(0, 0.15, 0);
        cam.distance = 7.4;
        cam.pitch = -0.15;
        if (state.autoOrbit) cam.yaw += ctx2.dt * 0.12 * state.spinSpeed;
        cam.update();
        const vp = cam.viewProjection;
        const eye = cam.eyePosition;

        // 统一 beginFrame（相机 + 显式打包的默认光）
        const mats = new Set<Material>([...items.map((i) => i.material), floor]);
        for (const m of mats) m.beginFrame(vp, eye, lights);
        floor.draw(pass, floorMesh);

        items.forEach((it) => {
          const m = it.mesh.model;
          m.setIdentity().translate(it.base[0], it.base[1], it.base[2]).scale(it.scale, it.scale, it.scale);
          const ang = state.objectSpin ? t * it.spinSpeed * state.spinSpeed : 0;
          if (it.spinAxis === "x") m.rotateX(ang);
          else m.rotateY(ang);
          it.material.draw(pass, it.mesh);
        });
      },
    };
  },
});
