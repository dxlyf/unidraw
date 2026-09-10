/**
 * 拾取示例：几何拾取（Raycaster，CPU 三角形求交）与 GPU 颜色拾取（ColorPicker，离屏 ID pass）
 * 同时运行并互相对照。
 *
 * - 鼠标移动：两条路径各自拾取一次，命中物体高亮；
 * - 左键点击：选中（保持高亮），HUD 显示两种方法的耗时与是否一致；
 * - `?selftest=1`：自动对若干物体的投影中心做批量拾取（pickMany 一次回读），
 *   在控制台打印 PICK_SELFTEST 结果（无头探针用它做双后端一致性验证）。
 */

import { bootDemo } from "../common/demo.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box, capsule, cone, cylinder, sphere, torus } from "../../src/render/primitives.js";
import { ColorMaterial, UnlitColorMaterial } from "../../src/render/material.js";
import { Mesh } from "../../src/render/Mesh.js";
import { Scene } from "../../src/scene/index.js";
import { Raycaster } from "../../src/interaction/Raycaster.js";
import { InputManager } from "../../src/interaction/InputManager.js";
import { ColorPicker } from "../../src/picking/ColorPicker.js";
import { Color } from "../../src/math/color.js";
import { Vec2 } from "../../src/math/vec2.js";
import type { Geometry as Geo } from "../../src/render/Geometry.js";

interface Pickable {
  mesh: Mesh;
  name: string;
  material: ColorMaterial;
}

bootDemo({
  title: "拾取 · 射线几何命中 + GPU 颜色拾取",
  run(ctx) {
    const device = ctx.device;
    const canvas = ctx.renderer.canvas;
    const scene = new Scene();

    const geos: { name: string; geo: Geo }[] = [
      { name: "box", geo: Geometry.create(device, box(0.9, 0.9, 0.9)) },
      { name: "sphere", geo: Geometry.create(device, sphere(0.55, 40, 24)) },
      { name: "torus", geo: Geometry.create(device, torus(0.42, 0.16, 36, 16)) },
      { name: "cylinder", geo: Geometry.create(device, cylinder(0.4, 0.4, 0.9, 32, 1)) },
      { name: "cone", geo: Geometry.create(device, cone(0.45, 0.95, 32)) },
      { name: "capsule", geo: Geometry.create(device, capsule(0.34, 0.6, 28, 10)) },
    ];
    const palette = ["#4c8dff", "#3dd68c", "#ff8f3d", "#f5c518", "#b07cff", "#ff5c8a", "#22d3ee", "#a3e635"];

    const pickables: Pickable[] = [];
    const COLS = 5;
    const ROWS = 4;
    for (let i = 0; i < COLS * ROWS; i++) {
      const kind = geos[i % geos.length]!;
      const material = new ColorMaterial(device, new Color().setHex(palette[i % palette.length]!), { label: `obj-${i}` });
      const mesh = new Mesh(kind.geo);
      const cx = (i % COLS) - (COLS - 1) / 2;
      const cz = Math.floor(i / COLS) - (ROWS - 1) / 2;
      mesh.model.setIdentity().translate(cx * 1.5, 0.7, cz * 1.5);
      mesh.material = material;
      scene.add(mesh);
      pickables.push({ mesh, name: `${kind.name}#${i}`, material });
    }

    const floorMat = new UnlitColorMaterial(device, new Color(0.1, 0.11, 0.15, 1), { label: "floor" });
    const floor = new Mesh(Geometry.create(device, box(12, 0.1, 12)));
    floor.model.setIdentity().translate(0, -0.05, 0);
    floor.material = floorMat;
    scene.add(floor);

    const highlight = new UnlitColorMaterial(device, new Color().setHex("#ffe066"), { label: "highlight" });

    const raycaster = new Raycaster();
    const picker = new ColorPicker(device, { label: "picking-demo" });
    const input = new InputManager(canvas, { preventWheelDefault: true });

    const hud = document.createElement("div");
    hud.id = "pick-hud";
    hud.style.cssText =
      "position:fixed;right:12px;top:12px;color:#d7d9e0;font:12px/1.6 ui-monospace,Consolas,monospace;" +
      "background:rgba(16,18,26,.72);border:1px solid #2b3040;border-radius:8px;padding:10px 12px;z-index:20;white-space:pre;pointer-events:none";
    document.body.appendChild(hud);

    let hovered: Pickable | null = null;
    let selected: Pickable | null = null;
    const ndc = new Vec2();
    let pickQueued = false;
    let busy = false;
    let lastRayText = "-";
    let lastColorText = "-";

    function setHighlight(target: Pickable | null): void {
      if (hovered === target) return;
      if (hovered) hovered.mesh.material = hovered.material;
      hovered = target;
      if (hovered && hovered !== selected) hovered.mesh.material = highlight;
    }

    function updateHud(): void {
      hud.textContent =
        `hover   : ${hovered?.name ?? "-"}\n` +
        `selected: ${selected?.name ?? "-"}\n` +
        `ray     : ${lastRayText}\n` +
        `color   : ${lastColorText}\n` +
        `对象数   : ${pickables.length}  ·  picker ${picker.size.width}x${picker.size.height}`;
    }

    /** 一次拾取：CPU 射线 + GPU 颜色，两条路径都跑，便于对照 */
    async function pickAt(point: Vec2): Promise<{ ray: string | null; color: string | null; same: boolean }> {
      // CPU：射线
      const tRay0 = performance.now();
      raycaster.setFromCamera(ctx.camera, point.x, point.y);
      const hit = raycaster.intersectFirst(scene);
      const rayMs = performance.now() - tRay0;
      const rayName = hit ? (pickables.find((p) => p.mesh === hit.object)?.name ?? "floor") : null;

      // GPU：颜色拾取（复用同一帧的 ID pass）
      const tColor0 = performance.now();
      const result = await picker.pick(scene, ctx.camera, { x: point.x, y: point.y });
      const colorMs = performance.now() - tColor0;
      const colorName = result.mesh ? (pickables.find((p) => p.mesh === result.mesh)?.name ?? "floor") : null;

      lastRayText = `${rayName ?? "无"}  (${rayMs.toFixed(2)}ms)`;
      lastColorText = `${colorName ?? "无"}  (${colorMs.toFixed(2)}ms, id=${result.id})`;
      return { ray: rayName, color: colorName, same: rayName === colorName };
    }

    async function processQueue(): Promise<void> {
      if (busy) {
        pickQueued = true;
        return;
      }
      busy = true;
      try {
        const res = await pickAt(ndc);
        const target = pickables.find((p) => p.name === res.color) ?? (res.color === "floor" ? null : pickables.find((p) => p.name === res.ray) ?? null);
        setHighlight(target);
        if (selected) selected.mesh.material = highlight;
        updateHud();
      } catch (e) {
        hud.textContent = `pick error: ${e instanceof Error ? e.message : String(e)}`;
      } finally {
        busy = false;
        if (pickQueued) {
          pickQueued = false;
          void processQueue();
        }
      }
    }

    input.on("pointermove", (e) => {
      ndc.copy(e.ndc);
      void processQueue();
    });
    input.on("click", (e) => {
      ndc.copy(e.ndc);
      void (async () => {
        const res = await pickAt(ndc);
        const target = pickables.find((p) => p.name === res.color) ?? null;
        if (selected && selected !== target) selected.mesh.material = selected.material;
        selected = target;
        if (selected) selected.mesh.material = highlight;
        updateHud();
      })();
    });
    input.on("keydown", (e) => {
      if (e.code === "Escape" && selected) {
        selected.mesh.material = selected.material;
        selected = null;
        updateHud();
      }
    });

    // ---- 自检（无头探针）：同一像素上「颜色拾取」与「射线拾取」应命中同一物体 ----
    const params = new URLSearchParams(location.search);
    const selfTest = params.get("selftest") !== "0";
    let selfTested = false;
    /** 自检期间冻结相机，保证「同一帧」内两种拾取使用完全相同的视图（跨后端可比） */
    let freezeCamera = false;

    const nameOf = (mesh: Mesh | null): string => {
      if (!mesh) return "miss";
      if (mesh === floor) return "floor";
      return pickables.find((p) => p.mesh === mesh)?.name ?? "unknown";
    };

    async function runSelfTest(): Promise<void> {
      // 固定视角：跨后端/跨运行得到完全相同的画面
      freezeCamera = true;
      ctx.camera.yaw = 0.42;
      ctx.camera.pitch = -0.18;
      ctx.camera.distance = 7.2;
      ctx.camera.update();
      // 采样式：覆盖画面的规则网格（取像素中心，避免落在像素边界上）
      const cols = 8;
      const rows = 5;
      const { width, height } = picker.size;
      const points: Vec2[] = [];
      for (let iy = 0; iy < rows; iy++) {
        for (let ix = 0; ix < cols; ix++) {
          const px = Math.floor(((ix + 0.5) / cols) * width);
          const py = Math.floor(((iy + 0.5) / rows) * height);
          points.push(new Vec2((px / width) * 2 - 1, 1 - (py / height) * 2));
        }
      }

      const t0 = performance.now();
      const results = await picker.pickMany(scene, ctx.camera, points);
      const gpuMs = performance.now() - t0;

      let agree = 0;
      let rayHits = 0;
      let colorHits = 0;
      const mismatches: string[] = [];
      points.forEach((point, i) => {
        raycaster.setFromCamera(ctx.camera, point.x, point.y);
        const ray = raycaster.intersectFirst(scene)?.object ?? null;
        const color = results[i]!.mesh;
        if (ray) rayHits++;
        if (color) colorHits++;
        if (ray === color) agree++;
        else if (mismatches.length < 8) {
          const px = picker.ndcToPixel(point);
          mismatches.push(`(${px.x},${px.y}) ray=${nameOf(ray)} color=${nameOf(color)}`);
        }
      });

      console.log(
        "PICK_SELFTEST " +
          JSON.stringify({
            backend: device.kind,
            samples: points.length,
            agree,
            ratio: Number((agree / points.length).toFixed(3)),
            rayHits,
            colorHits,
            allAgree: agree === points.length,
            gpuMs: Number(gpuMs.toFixed(2)),
            mismatch: mismatches,
          }),
      );
      freezeCamera = false;
    }

    let frames = 0;
    return {
      frame(pass, c) {
        frames++;
        // 让 picker 的 ID 目标跟随画布尺寸
        if (picker.size.width !== c.width || picker.size.height !== c.height) {
          picker.resize(c.width, c.height);
        }
        c.camera.center.set(0, 0.7, 0);
        if (!freezeCamera) c.camera.yaw += c.dt * 0.06;
        c.camera.update();
        const vp = c.camera.viewProjection;
        const eye = c.camera.eyePosition;
        for (const p of pickables) p.material.beginFrame(vp, eye);
        floorMat.beginFrame(vp, eye);
        highlight.beginFrame(vp, eye);
        for (const p of pickables) p.mesh.material!.drawGeometry(pass, p.mesh.geometry, p.mesh.worldMatrix);
        floorMat.drawGeometry(pass, floor.geometry, floor.worldMatrix);

        if (selfTest && !selfTested && frames === 20) {
          selfTested = true;
          void runSelfTest().catch((e) => console.log("PICK_SELFTEST_ERROR " + (e instanceof Error ? e.message : String(e))));
        }
      },
    };
  },
});
