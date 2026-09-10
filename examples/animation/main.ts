/**
 * 动画示例：关键帧轨道 / AnimationClip + Mixer / Tween 三条路径同时运行。
 *
 * - 层级动画：`carousel`（Node3D）做旋转轨道动画，挂在它下面的物体整体跟随
 *   （世界矩阵由脏标记自动传播）；
 * - 关键帧：`bouncer-hop` = 位置(回弹) + 缩放(squash) 两条轨道；
 *   `hero-paint` = 材质颜色轨道；`hero-spin` = 旋转轨道（ping-pong）；
 * - Mixer：循环模式 / 时间缩放 / 暂停都能用键盘切换；
 * - Tween：点击物体 → 弹出缩放 + 位移（`tweenObject` / `tweenVec3` / `tweenNumber`）；
 * - `?selftest=1`（默认开）：用固定时间步跑一遍动画，在控制台打印 ANIM_SELFTEST
 *   （用于无头双后端验证）。
 */

import { bootDemo } from "../common/demo.js";
import { Geometry } from "../../src/render/Geometry.js";
import { box, capsule, cone, cylinder, sphere, torus } from "../../src/render/primitives.js";
import { ColorMaterial, UnlitColorMaterial } from "../../src/render/material.js";
import { Mesh } from "../../src/render/Mesh.js";
import { Scene, Node3D } from "../../src/scene/index.js";
import { InputManager } from "../../src/interaction/InputManager.js";
import { ColorPicker } from "../../src/picking/ColorPicker.js";
import { Color } from "../../src/math/color.js";
import { Vec3 } from "../../src/math/vec3.js";
import { degToRad } from "../../src/math/mmath.js";
import {
  AnimationClip,
  AnimationMixer,
  TweenManager,
  colorKeys,
  materialColorTrack,
  nodePositionTrack,
  nodeRotationTrack,
  nodeScaleTrack,
  numberTrack,
  tweenNumber,
  tweenObject,
  tweenVec3,
  vec3Keys,
  type LoopMode,
} from "../../src/animation/index.js";

interface Item {
  mesh: Mesh;
  material: ColorMaterial;
  home: Vec3;
}

bootDemo({
  title: "动画 · 关键帧轨道 / AnimationClip + Mixer / Tween",
  run(ctx) {
    const device = ctx.device;
    const canvas = ctx.renderer.canvas;
    const scene = new Scene();

    // ---- 层级：carousel 旋转，子节点跟随 ------------------------------------
    const carousel = new Node3D();
    carousel.name = "carousel";
    scene.add(carousel);

    const geos = [
      Geometry.create(device, box(0.7, 0.7, 0.7)),
      Geometry.create(device, sphere(0.42, 32, 20)),
      Geometry.create(device, torus(0.34, 0.13, 28, 14)),
      Geometry.create(device, cylinder(0.3, 0.3, 0.7, 24, 1)),
      Geometry.create(device, cone(0.34, 0.75, 24)),
      Geometry.create(device, capsule(0.26, 0.45, 24, 8)),
    ];
    const palette = ["#4c8dff", "#3dd68c", "#ff8f3d", "#f5c518", "#b07cff", "#ff5c8a"];
    const items: Item[] = [];
    for (let i = 0; i < 6; i++) {
      const material = new ColorMaterial(device, new Color().setHex(palette[i]!), { label: `item-${i}` });
      const mesh = new Mesh(geos[i % geos.length]!);
      const a = (i / 6) * Math.PI * 2;
      const home = new Vec3(Math.cos(a) * 2.3, 0.6, Math.sin(a) * 2.3);
      mesh.setPosition(home.x, home.y, home.z);
      mesh.material = material;
      carousel.add(mesh);
      items.push({ mesh, material, home });
    }

    // 弹跳体（位置 + 缩放两条轨道驱动）
    const bouncer = new Mesh(Geometry.create(device, sphere(0.3, 24, 16)));
    const bouncerMat = new UnlitColorMaterial(device, new Color().setHex("#ffe066"), { label: "bouncer" });
    bouncer.material = bouncerMat;
    bouncer.setPosition(0, 1.6, 0);
    carousel.add(bouncer);

    // 材质颜色动画的目标
    const hero = new Mesh(Geometry.create(device, torus(0.8, 0.28, 40, 20)));
    const heroMat = new ColorMaterial(device, new Color().setHex("#22d3ee"), { label: "hero" });
    hero.material = heroMat;
    hero.setPosition(0, 2.4, 0);
    scene.add(hero);

    const floorMat = new UnlitColorMaterial(device, new Color(0.09, 0.1, 0.14, 1), { label: "floor" });
    const floor = new Mesh(Geometry.create(device, box(14, 0.1, 14)));
    floor.setPosition(0, -0.6, 0);
    floor.material = floorMat;
    scene.add(floor);

    // ---- 动画数据 -----------------------------------------------------------
    const carouselSpin = new AnimationClip("carousel-spin", { duration: 6 }).addTrack(
      nodeRotationTrack(
        carousel,
        vec3Keys([
          { time: 0, value: [0, 0, 0] },
          { time: 6, value: [0, Math.PI * 2, 0] },
        ]),
      ),
    );

    const bouncerHop = new AnimationClip("bouncer-hop", { duration: 2 }).addTracks(
      nodePositionTrack(
        bouncer,
        vec3Keys([
          { time: 0, value: [0, 1.6, 0], easing: "quadOut" },
          { time: 0.5, value: [0, 3.0, 0], easing: "quadIn" },
          { time: 1, value: [0, 1.6, 0] },
          { time: 2, value: [0, 1.6, 0] },
        ]),
      ),
      nodeScaleTrack(
        bouncer,
        vec3Keys([
          { time: 0, value: [1, 1, 1] },
          { time: 0.5, value: [0.85, 1.25, 0.85], easing: "sineOut" },
          { time: 1, value: [1.2, 0.8, 1.2], easing: "sineIn" },
          { time: 1.2, value: [1, 1, 1] },
          { time: 2, value: [1, 1, 1] },
        ]),
      ),
    );

    const heroPaint = new AnimationClip("hero-paint", { duration: 6 }).addTrack(
      materialColorTrack(
        heroMat,
        colorKeys([
          { time: 0, value: "#22d3ee" },
          { time: 1.5, value: "#4c8dff", easing: "smooth" },
          { time: 3, value: "#b07cff", easing: "smooth" },
          { time: 4.5, value: "#ff5c8a", easing: "smooth" },
          { time: 6, value: "#22d3ee", easing: "smooth" },
        ]),
      ),
    );

    const heroSpin = new AnimationClip("hero-spin", { duration: 4 }).addTrack(
      nodeRotationTrack(
        hero,
        vec3Keys([
          { time: 0, value: [degToRad(20), 0, 0] },
          { time: 2, value: [degToRad(20), Math.PI, degToRad(30)] },
          { time: 4, value: [degToRad(20), Math.PI * 2, 0] },
        ]),
      ),
    );

    const mixer = new AnimationMixer(scene);
    const tweens = new TweenManager();

    mixer.play(carouselSpin, { loop: "repeat" });
    mixer.play(bouncerHop, { loop: "repeat" });
    mixer.play(heroPaint, { loop: "repeat" });
    const heroSpinAction = mixer.play(heroSpin, { loop: "ping-pong" });

    // 纯 Tween 驱动的“呼吸”灯（不写关键帧）
    const breathLight = new Mesh(Geometry.create(device, sphere(0.18, 16, 12)));
    const breathMat = new UnlitColorMaterial(device, new Color().setHex("#ff8f3d"), { label: "breath" });
    breathLight.material = breathMat;
    breathLight.setPosition(-2.6, 0.2, -2.6);
    scene.add(breathLight);
    const breathColor = new Color(1, 0.56, 0.23, 1);
    tweens.add(
      tweenNumber(
        0,
        1,
        1.6,
        (v) => {
          const s = 0.6 + v * 1.4;
          breathLight.setScale(s, s, s);
          breathColor.set(1, 0.56 + v * 0.25, 0.23, 1);
          breathMat.setColor(breathColor);
        },
        { easing: "sineInOut", repeat: Number.POSITIVE_INFINITY, yoyo: true },
      ),
    );

    // ---- 交互：点击物体 → Tween 弹出 ----------------------------------------
    const picker = new ColorPicker(device, { label: "anim-pick" });
    const input = new InputManager(canvas, { preventWheelDefault: true });

    const hud = document.createElement("div");
    hud.id = "anim-hud";
    hud.style.cssText =
      "position:fixed;right:12px;top:12px;color:#d7d9e0;font:12px/1.6 ui-monospace,Consolas,monospace;" +
      "background:rgba(16,18,26,.72);border:1px solid #2b3040;border-radius:8px;padding:10px 12px;z-index:20;white-space:pre;pointer-events:none";
    document.body.appendChild(hud);

    let loopMode: LoopMode = "repeat";
    let clicks = 0;

    function popItem(item: Item): void {
      clicks++;
      const target = item.home.clone().multiplyScalar(1.35);
      target.y += 0.9;
      tweens.add(
        tweenVec3(
          new Vec3(item.mesh.position.x, item.mesh.position.y, item.mesh.position.z),
          target,
          0.28,
          (v) => item.mesh.setPosition(v.x, v.y, v.z),
          { easing: "backOut", yoyo: true, repeat: 1 },
        ),
      );
      tweens.add(
        tweenObject(item.mesh.scale, { x: 1.7, y: 1.7, z: 1.7 }, 0.16, {
          easing: "quadOut",
          yoyo: true,
          repeat: 1,
          markDirty: true,
        }),
      );
    }

    input.on("click", (e) => {
      void picker
        .pick(scene, ctx.camera, { x: e.ndc.x, y: e.ndc.y })
        .then((r) => {
          const hit = items.find((it) => it.mesh === r.mesh);
          if (hit) popItem(hit);
        })
        .catch(() => {});
    });
    input.on("keydown", (e) => {
      if (e.code === "Space") mixer.timeScale = mixer.timeScale === 0 ? 1 : 0;
      else if (e.code === "Digit1") mixer.timeScale = 0.25;
      else if (e.code === "Digit2") mixer.timeScale = 1;
      else if (e.code === "Digit3") mixer.timeScale = 2;
      else if (e.code === "KeyL") {
        const modes: LoopMode[] = ["repeat", "ping-pong", "once"];
        loopMode = modes[(modes.indexOf(loopMode) + 1) % modes.length]!;
        for (const a of mixer.actions) a.loop = loopMode;
        if (loopMode === "once") for (const a of mixer.actions) a.restart();
      } else if (e.code === "KeyT") {
        for (const it of items) popItem(it);
      }
    });

    function updateHud(): void {
      hud.textContent =
        `backend : ${device.kind}\n` +
        `mixer   : t=${mixer.elapsed.toFixed(2)}s  scale=${mixer.timeScale}  loop=${loopMode}\n` +
        `clips   : ${mixer.activeClipNames.join(", ") || "(none)"}\n` +
        `tweens  : ${tweens.count}   点击次数: ${clicks}\n` +
        `keys    : Space 暂停 · 1/2/3 速度 · L 循环模式 · T 全部弹出`;
    }

    // ---- 自检（无头探针） ---------------------------------------------------
    const selfTest = new URLSearchParams(location.search).get("selftest") !== "0";
    let selfTested = false;
    let freeze = false;

    async function runSelfTest(): Promise<void> {
      freeze = true;
      // 1) 关键帧求值（纯函数，与后端无关）；段缓动取「左端关键帧」
      const probe = numberTrack(() => {}, [
        { time: 0, value: 0, easing: "quadIn" },
        { time: 1, value: 10 },
      ]);
      const sampleHalf = probe.sample(0.5);
      const sampleEnd = probe.sample(99);

      // 2) 固定时间步跑动画（90 帧 × 1/60s）
      mixer.stopAll();
      const spin = mixer.play(carouselSpin, { loop: "repeat" });
      const hop = mixer.play(bouncerHop, { loop: "repeat" });
      const paint = mixer.play(heroPaint, { loop: "repeat" });
      for (let i = 0; i < 90; i++) mixer.update(1 / 60);
      scene.updateWorldMatrix(true);
      // 由世界矩阵反解绕 Y 旋转角（证明脏标记传播 + 世界矩阵已更新）
      const e = carousel.worldMatrix.elements;
      const worldAngle = Math.atan2(e[8]!, e[0]!);
      // 子节点世界位置应随父节点旋转（层级动画）
      const child = items[0]!.mesh.worldMatrix.elements;
      const childOrbit = Math.hypot(child[12]!, child[14]!);
      const childY = child[13]!;

      // 3) Tween：数值 + 对象属性
      const tw = tweenNumber(0, 4, 1, () => {}, { easing: "linear" });
      tw.play();
      tw.update(0.5);
      const objTarget = { a: 0, b: 10 };
      const ot = tweenObject(objTarget, { a: 8, b: 0 }, 1, { easing: "linear" });
      ot.play();
      ot.update(0.25);

      const expectedAngle = ((90 / 60) * (Math.PI * 2)) / 6;
      const result = {
        backend: device.kind,
        sampleHalf: Number(sampleHalf.toFixed(4)),
        sampleEnd: Number(sampleEnd.toFixed(4)),
        mixerTime: Number(spin.time.toFixed(4)),
        loops: spin.loopCount,
        worldAngle: Number(worldAngle.toFixed(4)),
        childOrbit: Number(childOrbit.toFixed(4)),
        childY: Number(childY.toFixed(4)),
        bouncerY: Number(bouncer.position.y.toFixed(4)),
        heroColor: [Number(heroMat.color.r.toFixed(3)), Number(heroMat.color.g.toFixed(3)), Number(heroMat.color.b.toFixed(3))],
        tweenValue: Number(tw.value.toFixed(4)),
        tweenObject: [objTarget.a, objTarget.b],
        keyframeOk: Math.abs(sampleHalf - 2.5) < 1e-6 && Math.abs(sampleEnd - 10) < 1e-6,
        mixingOk: spin.running && hop.running && paint.running,
        writeBackOk: Math.abs(worldAngle - expectedAngle) < 1e-3,
        hierarchyOk: Math.abs(childOrbit - 2.3) < 1e-3 && Math.abs(childY - 0.6) < 1e-3,
        bouncerOk: bouncer.position.y > 1.0 && bouncer.position.y < 3.1,
        tweenOk: Math.abs(tw.value - 2) < 1e-6 && Math.abs(objTarget.a - 2) < 1e-6 && Math.abs(objTarget.b - 7.5) < 1e-6,
      };
      console.log("ANIM_SELFTEST " + JSON.stringify(result));

      // 恢复演示状态
      mixer.stopAll();
      spin.play();
      hop.play();
      paint.play();
      heroSpinAction.play();
      freeze = false;
    }

    let frames = 0;
    // 初始取景（之后交给轨道相机）
    ctx.camera.distance = 8.2;
    ctx.camera.pitch = degToRad(-14);
    ctx.camera.center.set(0, 1.2, 0);
    ctx.camera.update();

    return {
      frame(pass, c) {
        frames++;
        c.camera.center.set(0, 1.2, 0);
        if (!freeze) c.camera.yaw += c.dt * 0.08;
        c.camera.update();

        if (!freeze) {
          mixer.update(c.dt);
          tweens.update(c.dt);
        }

        const vp = c.camera.viewProjection;
        const eye = c.camera.eyePosition;
        const mats = new Set([...items.map((i) => i.material), bouncerMat, heroMat, floorMat, breathMat]);
        for (const m of mats) m.beginFrame(vp, eye);

        scene.updateWorldMatrix(true);
        for (const it of items) it.material.drawGeometry(pass, it.mesh.geometry, it.mesh.worldMatrix);
        bouncerMat.drawGeometry(pass, bouncer.geometry, bouncer.worldMatrix);
        heroMat.drawGeometry(pass, hero.geometry, hero.worldMatrix);
        breathMat.drawGeometry(pass, breathLight.geometry, breathLight.worldMatrix);
        floorMat.drawGeometry(pass, floor.geometry, floor.worldMatrix);

        picker.resize(c.width, c.height);
        updateHud();

        if (selfTest && !selfTested && frames === 20) {
          selfTested = true;
          void runSelfTest().catch((e) =>
            console.log("ANIM_SELFTEST_ERROR " + (e instanceof Error ? e.message : String(e))),
          );
        }
      },
    };
  },
});
