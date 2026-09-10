/**
 * 灯光示例：环境光 / 方向光（平行光）/ 点光 / 聚光 四种灯 + 动画 + 交互开关。
 *
 * - 环境光：整体抬亮（暗蓝，避免死黑）；
 * - 方向光：暖色平行光（模拟太阳），从左上打下；
 * - 点光：3 个彩色点光绕场旋转（世界位置来自节点），展示距离衰减；
 * - 聚光：从上方缓慢画圈的白色聚光，展示 `angle` / `penumbra` / `distance`；
 * - 键盘 1/2/3/4 切换各类型灯、5 全开、0 全关（全关 = 无光照，只剩 Unlit 地面）；
 * - `?selftest=1`（默认）：离屏渲染四种灯光配置并比较亮像素比例，
 *   证明「关灯会变暗、单灯能照亮」，同时给出跨后端可比的数值。
 *
 * 说明：主循环里手动 `collectLights()` 后传给 `material.beginFrame(vp, eye, lights)`；
 * 若用 `SceneRenderer` / `App` 渲染，灯光会**自动**收集并喂给材质，无需手动调用。
 */

import { bootDemo } from "../common/demo.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box, capsule, cone, cylinder, plane, sphere, torus } from "../../src/render/primitives.js";
import { ColorMaterial, PhongMaterial, UnlitColorMaterial } from "../../src/render/material.js";
import { Mesh } from "../../src/render/Mesh.js";
import { Scene, SceneRenderer } from "../../src/scene/index.js";
import { Color } from "../../src/math/color.js";
import { Vec3 } from "../../src/math/vec3.js";
import { degToRad } from "../../src/math/mmath.js";
import {
  AmbientLight,
  DirectionalLight,
  PointLight,
  SpotLight,
  LightsState,
  collectLights,
} from "../../src/render/lights/index.js";
import { TextureUsage } from "../../src/gpu/types.js";
import type { TextureFormat } from "../../src/gpu/types.js";
import type { RenderPassEncoder } from "../../src/command/encoder.js";
import type { Mat4 } from "../../src/math/mat4.js";

bootDemo({
  title: "灯光 · 环境光 / 方向光 / 点光 / 聚光",
  run(ctx) {
    const device = ctx.device;
    const scene = new Scene();
    const targetFormat = (device.canvasFormat?.() ?? "rgba8unorm") as TextureFormat;

    // ---- 地面与物体 --------------------------------------------------------
    const floorMat = new UnlitColorMaterial(device, new Color(0.12, 0.13, 0.16, 1), { label: "floor", targetFormat });
    const floor = new Mesh(Geometry.create(device, plane(26, 26, 1, 1)));
    floor.model.setIdentity().rotateX(degToRad(-90)).translate(0, -0.9, 0);
    floor.material = floorMat;
    scene.add(floor);

    // 两排「接收光」的物体：Lambert / Phong 交替
    const geos = [
      Geometry.create(device, box(1, 1, 1)),
      Geometry.create(device, sphere(0.62, 40, 24)),
      Geometry.create(device, torus(0.5, 0.2, 36, 18)),
      Geometry.create(device, cylinder(0.45, 0.45, 1, 32, 1)),
      Geometry.create(device, cone(0.55, 1.1, 32)),
      Geometry.create(device, capsule(0.4, 0.7, 32, 10)),
    ];
    const palette = ["#e9eef7", "#c9d6ea", "#9fb4d8", "#e6d7c3", "#d7c9e6", "#cfe6d7"];
    const meshes: Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const isPhong = i % 2 === 1;
      const material = isPhong
        ? new PhongMaterial(device, new Color().setHex(palette[i]!), {
            label: `phong-${i}`,
            shininess: 90,
            specular: 0.9,
            ambient: 0.4,
            targetFormat,
          })
        : new ColorMaterial(device, new Color().setHex(palette[i]!), { label: `lambert-${i}`, targetFormat });
      const mesh = new Mesh(geos[i % geos.length]!);
      mesh.setPosition((i - 2.5) * 1.7, 0.2, Math.cos(i * 1.7) * 0.9);
      mesh.material = material;
      scene.add(mesh);
      meshes.push(mesh);
    }

    // ---- 四种灯 ------------------------------------------------------------
    const ambient = new AmbientLight("#5b6f96", 0.5);
    scene.add(ambient);

    const sun = new DirectionalLight(new Vec3(0.45, -0.8, -0.4), "#ffe6c2", 0.9);
    scene.add(sun);

    const pointColors = ["#ff4d6d", "#3dd68c", "#4c8dff"];
    const orbits = [
      { radius: 3.2, height: 2.0, speed: 0.55, phase: 0 },
      { radius: 4.0, height: 2.6, speed: 0.4, phase: 2.1 },
      { radius: 4.8, height: 1.6, speed: 0.3, phase: 4.2 },
    ];
    const points = pointColors.map((hex, i) => {
      const light = new PointLight(hex, 30, 16, 2);
      light.name = `point-${i}`;
      scene.add(light);
      return light;
    });

    const spot = new SpotLight("#ffffff", 60);
    spot.setDirection(0, -1, 0).setAngle(degToRad(22), 0.4);
    spot.distance = 24;
    spot.setPosition(0, 7, 0);
    scene.add(spot);

    // ---- HUD / 交互 --------------------------------------------------------
    const hud = document.createElement("div");
    hud.id = "light-hud";
    hud.style.cssText =
      "position:fixed;right:12px;top:12px;color:#d7d9e0;font:12px/1.6 ui-monospace,Consolas,monospace;" +
      "background:rgba(16,18,26,.72);border:1px solid #2b3040;border-radius:8px;padding:10px 12px;z-index:20;white-space:pre;pointer-events:none";
    document.body.appendChild(hud);

    const state = { ambient: true, sun: true, points: true, spot: true };
    function applyState(): void {
      ambient.visible = state.ambient;
      sun.visible = state.sun;
      for (const p of points) p.visible = state.points;
      spot.visible = state.spot;
    }
    function updateHud(lightCount: number, usedDefault: boolean): void {
      const on = (b: boolean): string => (b ? "●" : "○");
      hud.textContent =
        `${on(state.ambient)} 1 环境光 AmbientLight   intensity ${ambient.intensity}\n` +
        `${on(state.sun)} 2 方向光 DirectionalLight intensity ${sun.intensity}  dir(${sun.direction.x}, ${sun.direction.y}, ${sun.direction.z})\n` +
        `${on(state.points)} 3 点光 PointLight ×${points.length}     intensity ${points[0]!.intensity} range ${points[0]!.distance} decay ${points[0]!.decay}\n` +
        `${on(state.spot)} 4 聚光 SpotLight          angle ${Math.round((spot.angle * 180) / Math.PI)}° penumbra ${spot.penumbra} range ${spot.distance}\n` +
        `光照：${lightCount} 盏${usedDefault ? "（默认光）" : ""}   顶部上限：方向 4 / 点 8 / 聚 4\n` +
        `keys: 1/2/3/4 开关 · 5 全开 · 0 全关 · Space 暂停旋转`;
    }

    window.addEventListener("keydown", (e) => {
      if (e.code === "Digit1") state.ambient = !state.ambient;
      else if (e.code === "Digit2") state.sun = !state.sun;
      else if (e.code === "Digit3") state.points = !state.points;
      else if (e.code === "Digit4") state.spot = !state.spot;
      else if (e.code === "Digit5") {
        state.ambient = state.sun = state.points = state.spot = true;
      } else if (e.code === "Digit0") {
        state.ambient = state.sun = state.points = state.spot = false;
      } else return;
      applyState();
    });

    // ---- 渲染（手动收集灯光并喂给材质） ------------------------------------
    const lightsState = new LightsState();
    const lightsInfo = { count: 0, usedDefault: false };

    function drawScene(pass: RenderPassEncoder, camera: typeof ctx.camera): void {
      const result = collectLights(scene, lightsState);
      lightsInfo.count = result.present;
      lightsInfo.usedDefault = result.usedDefault;
      const vp = camera.viewProjection;
      const eye = camera.eyePosition;
      floorMat.beginFrame(vp, eye, lightsState);
      for (const mesh of meshes) {
        const material = mesh.material as unknown as {
          beginFrame(viewProjection: Mat4, cameraPos: Vec3, lights: LightsState): void;
          draw(pass: RenderPassEncoder, mesh: Mesh): void;
        };
        material.beginFrame(vp, eye, lightsState);
      }
      floorMat.draw(pass, floor);
      for (const mesh of meshes) {
        (mesh.material as unknown as { draw(pass: RenderPassEncoder, mesh: Mesh): void }).draw(pass, mesh);
      }
    }

    // ---- 自检：离屏渲染不同灯光配置并比较亮像素 ----------------------------
    const selfTest = new URLSearchParams(location.search).get("selftest") !== "0";
    let tested = false;
    let elapsed = 0;

    async function renderWith(config: Partial<typeof state>): Promise<number> {
      const W = 200;
      const H = 140;
      const color = device.createTexture({
        label: "lights-selftest",
        width: W,
        height: H,
        format: targetFormat,
        usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.COPY_SRC,
      });
      const depth = device.createTexture({
        label: "lights-selftest-depth",
        width: W,
        height: H,
        format: "depth24plus",
        usage: TextureUsage.RENDER_ATTACHMENT,
      });
      Object.assign(state, config);
      applyState();
      const renderer = new SceneRenderer(); // 灯光自动收集
      const encoder = device.createCommandEncoder("lights-selftest");
      const pass = encoder.beginRenderPass({
        label: "lights-selftest",
        colorAttachments: [{ view: color.view(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        depthStencilAttachment: { view: depth.view(), depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: 1 },
      });
      renderer.render(pass, scene, ctx.camera);
      pass.end();
      device.submit([enc_finish(encoder)]);
      const px = await device.readTexturePixels(color);
      let bright = 0;
      for (let i = 0; i < px.length; i += 4) {
        const l = 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
        if (l > 70) bright++;
      }
      color.destroy();
      depth.destroy();
      return bright / (px.length / 4);
    }

    function enc_finish(encoder: ReturnType<typeof device.createCommandEncoder>) {
      return encoder.finish();
    }

    let frames = 0;
    return {
      frame(pass, c) {
        frames++;
        elapsed += c.dt;
        // 点光绕场 + 聚光画圈
        for (let i = 0; i < points.length; i++) {
          const o = orbits[i]!;
          const a = o.phase + elapsed * o.speed;
          points[i]!.setPosition(Math.cos(a) * o.radius, o.height + Math.sin(a * 2) * 0.35, Math.sin(a) * o.radius);
        }
        const sa = elapsed * 0.3;
        spot.setPosition(Math.cos(sa) * 2.4, 6.4, Math.sin(sa) * 2.4);
        spot.setDirection(-Math.cos(sa) * 0.3, -1, -Math.sin(sa) * 0.3);

        c.camera.center.set(0, 0, 0);
        c.camera.distance = 12;
        c.camera.pitch = 0.2;
        c.camera.yaw += c.dt * 0.04;
        c.camera.update();

        drawScene(pass, c.camera);
        updateHud(lightsInfo.count, lightsInfo.usedDefault);

        if (selfTest && !tested && frames === 30) {
          tested = true;
          void (async () => {
            try {
              const all = await renderWith({ ambient: true, sun: true, points: true, spot: true });
              const none = await renderWith({ ambient: false, sun: false, points: false, spot: false });
              const spotOnly = await renderWith({ ambient: false, sun: false, points: false, spot: true });
              const pointOnly = await renderWith({ ambient: false, sun: false, points: true, spot: false });
              const sunOnly = await renderWith({ ambient: false, sun: true, points: false, spot: false });
              const result = {
                backend: device.kind,
                all: Number(all.toFixed(4)),
                none: Number(none.toFixed(4)),
                spotOnly: Number(spotOnly.toFixed(4)),
                pointOnly: Number(pointOnly.toFixed(4)),
                sunOnly: Number(sunOnly.toFixed(4)),
                darkenOk: none < all * 0.6,
                eachLightOk: spotOnly > 0 && pointOnly > 0 && sunOnly > 0,
              };
              console.log("LIGHTS_SELFTEST " + JSON.stringify(result));
              applyState();
            } catch (e) {
              console.log("LIGHTS_SELFTEST_ERROR " + (e instanceof Error ? e.message : String(e)));
            }
          })();
        }
      },
    };
  },
});
