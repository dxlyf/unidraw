/**
 * 示例游戏《坦克世界》（Tank World）—— 用一个完整小游戏把框架能力串起来。
 *
 * 玩法：
 * - **W/S** 前进/倒车、**A/D** 车体转向、**鼠标** 瞄准（炮塔转向指针在地面的落点）、
 *   **空格/左键** 开火、**Shift** 慢动作、**R** 重开一局、滚轮缩放视角；
 * - 敌人 AI 会巡逻、发现玩家后追击并开火，被击毁 4 秒后复活；玩家被击毁 2.5 秒后复活。
 *
 * 用到的框架能力（这个示例的意义）：
 * - 场景图（车体 → 炮塔 → 炮管 → 炮口 的层级）与 `SceneRenderer`（剔除/排序/统计）；
 * - `PhongMaterial`（车体/掩体/地面）+ `UnlitColorMaterial`（特效/炮弹）；
 * - **混合模式**：闪光/爆炸/炮弹用叠加发光，烟雾用普通 alpha 混合（半透明自动排序）；
 * - **阴影**：方向光投影，坦克与掩体投/收阴影（`ShadowRenderer`）；
 * - **后处理**：泛光（让爆炸发光）+ 色调映射 + 暗角（`EffectComposer`，可整体关掉对比）；
 * - `InputManager`（键鼠）、`Camera`（第三人称跟随 + 抖动）、`Raycaster`（鼠标 → 地面瞄准点）；
 * - lil-gui 参数面板；`TANK_SELFTEST` 确定性自检（无头双后端回归可跑）。
 */

import { Renderer } from "../../src/render/Renderer.js";
import { Camera } from "../../src/render/Camera.js";
import { Scene, SceneRenderer } from "../../src/scene/index.js";
import { AmbientLight, DirectionalLight } from "../../src/render/lights/index.js";
import { Vec3 } from "../../src/math/vec3.js";
import { degToRad, clamp } from "../../src/math/mmath.js";
import { InputManager } from "../../src/interaction/InputManager.js";
import { Raycaster } from "../../src/interaction/Raycaster.js";
import { RenderTarget } from "../../src/render/RenderTarget.js";
import { EffectComposer, BloomPass, ToneMapPass, VignettePass } from "../../src/render/postfx/index.js";
import { ShadowRenderer } from "../../src/render/shadow/index.js";
import { Arena, createRandom } from "./arena.js";
import { NO_INPUT, Tank, type TankInput } from "./tank.js";
import { EffectPool, ProjectilePool, type ProjectileHit } from "./effects.js";
import { applyUrlOverrides, createGui } from "../common/gui.js";

const canvas = document.createElement("canvas");
canvas.id = "canvas";
canvas.style.cssText = "display:block;width:100vw;height:100vh;touch-action:none;cursor:crosshair";
document.body.style.cssText = "margin:0;background:#07080b;overflow:hidden";
document.body.appendChild(canvas);

const params = new URLSearchParams(location.search);
const backend = params.get("backend") as "auto" | "webgpu" | "webgl2" | null;

const status: { backend: string; err: string; frames: number } = { backend: "", err: "", frames: 0 };
(globalThis as Record<string, unknown>).__unidraw = { get status() { return status; } };
window.addEventListener("error", (e) => (status.err = e.message));
window.addEventListener("unhandledrejection", (e) => {
  status.err = e.reason instanceof Error ? e.reason.message : String(e.reason);
});

const renderer = await Renderer.create(canvas, { backend: backend ?? "auto", background: "#07080b" });
status.backend = renderer.device.kind;
const device = renderer.device;
const canvasFormat = (device.canvasFormat?.() ?? "rgba8unorm") as "rgba8unorm" | "bgra8unorm";

// ---- 参数（URL 可覆盖；右上角 lil-gui 实时调） -------------------------------
const state = {
  // 游戏
  enemies: 4,
  playerSpeed: 14,
  enemySpeed: 9.5,
  enemyAccuracy: 0.7,
  damage: 34,
  reload: 1.05,
  enemyFireDelay: 1.2,
  timeScale: 1,
  paused: false,
  // 画质
  shadows: true,
  shadowMapSize: 1024,
  postfx: true,
  bloom: true,
  tonemap: true,
  vignette: true,
  msaa: 1,
  // 相机
  cameraDistance: 15,
  cameraPitch: 20,
  cameraSmooth: 0.16,
  freeLook: false,
};
applyUrlOverrides(state, params);

// ---- 场景、灯光、战场 -------------------------------------------------------
const scene = new Scene();
const arena = new Arena(device, scene, { halfSize: 46, random: params.get("layout") === "random" });
const effects = new EffectPool(device, scene, { perKind: 12 });
const projectiles = new ProjectilePool(device, scene, 28);

scene.add(new AmbientLight("#3c4557", 0.55));
const sun = new DirectionalLight(new Vec3(-0.55, -1, -0.35), "#fff1cf", 1.05);
sun.shadow.bias = 0.0016;
sun.shadow.normalBias = 0.04;
sun.shadow.radius = 1.4;
scene.add(sun);
function applyShadowSettings(): void {
  sun.castShadow = state.shadows;
  sun.shadow.mapSize = state.shadowMapSize;
}
applyShadowSettings();

const sceneRenderer = new SceneRenderer();
const shadowRenderer = new ShadowRenderer(device, { label: "tank-shadows" });

// ---- 坦克 -------------------------------------------------------------------
const TEAM_PLAYER = "#3f7ddb";
const TEAM_ENEMY = "#c4483f";
const random = createRandom(20240607);
const player = new Tank(device, scene, {
  color: TEAM_PLAYER,
  label: "player",
  speed: state.playerSpeed,
  reloadTime: state.reload,
  damage: state.damage,
  maxHp: 130,
});
const enemies: Tank[] = [];
const aiStates = new Map<Tank, { mode: "patrol" | "engage"; targetX: number; targetZ: number; think: number; nextFire: number }>();

function spawnEnemy(tank: Tank, index: number, total: number): void {
  const spawn = freeSpawn(new Vec3(), 20);
  const angle = (index / Math.max(1, total)) * Math.PI * 2 + random() * 0.6;
  tank.reset(spawn.x, spawn.z, angle + Math.PI);
  tank.cooldown = 0.6 + random() * 1.4;
  aiStates.set(tank, { mode: "patrol", targetX: 0, targetZ: 0, think: 0, nextFire: 0.5 + random() });
}

function rebuildEnemies(): void {
  for (const tank of enemies) tank.root.removeFromParent();
  enemies.length = 0;
  aiStates.clear();
  for (let i = 0; i < state.enemies; i++) {
    const tank = new Tank(device, scene, {
      color: TEAM_ENEMY,
      label: `enemy-${i}`,
      speed: state.enemySpeed,
      reloadTime: 1.5,
      damage: Math.round(state.damage * 0.7),
      maxHp: 100,
      radius: 1.3,
    });
    enemies.push(tank);
    spawnEnemy(tank, i, state.enemies);
  }
}

// ---- 游戏数据 ---------------------------------------------------------------
const game = {
  kills: 0,
  playerDeaths: 0,
  shots: 0,
  hits: 0,
  enemyShots: 0,
  time: 0,
  respawnIn: 0,
  hitMarker: 0,
  restart(): void {
    this.kills = 0;
    this.playerDeaths = 0;
    this.shots = 0;
    this.hits = 0;
    this.enemyShots = 0;
    this.time = 0;
    this.respawnIn = 0;
    this.hitMarker = 0;
    projectiles.clear();
    const spawn = freeSpawn(new Vec3(), 18);
    player.reset(spawn.x, spawn.z, 0);
    rebuildEnemies();
  },
};
const initialSpawn = freeSpawn(new Vec3(), 18);
player.reset(initialSpawn.x, initialSpawn.z, 0);
rebuildEnemies();

// ---- 相机（第三人称跟随） ---------------------------------------------------
const camera = new Camera();
camera.setPerspective(degToRad(52), canvas.width / Math.max(1, canvas.height), 0.1, 400);
camera.distance = state.cameraDistance;
camera.pitch = degToRad(state.cameraPitch);
camera.center.set(0, 1.1, 26);
camera.yaw = Math.PI;
camera.update();
const cameraState = { yaw: camera.yaw, x: 0, z: 26 };

// ---- 输入 -------------------------------------------------------------------
const input = new InputManager(canvas, { preventWheelDefault: true });
const keys = new Set<string>();
input.on("keydown", (e) => {
  keys.add(e.code);
  if (e.code === "KeyR") game.restart();
});
input.on("keyup", (e) => keys.delete(e.code));
let pointerNdc = { x: 0, y: 0.1 };
let pointerDown = false;
let fireQueued = false;
input.on("pointermove", (e) => {
  pointerNdc = { x: e.ndc.x, y: e.ndc.y };
});
input.on("pointerdown", (e) => {
  pointerDown = true;
  fireQueued = true;
  pointerNdc = { x: e.ndc.x, y: e.ndc.y };
});
input.on("pointerup", () => {
  pointerDown = false;
});
input.on("wheel", (e) => {
  state.cameraDistance = clamp(state.cameraDistance * (1 + e.deltaY * 0.0012), 7, 40);
  camera.distance = state.cameraDistance;
});

const raycaster = new Raycaster();
/** 找一个不被掩体占据的出生点（避免坦克卡在掩体里） */
function freeSpawn(out = new Vec3(), minDistance = 14): Vec3 {
  for (let i = 0; i < 60; i++) {
    const angle = random() * Math.PI * 2;
    const distance = minDistance + random() * (arena.halfSize - minDistance - 4);
    const x = Math.sin(angle) * distance;
    const z = Math.cos(angle) * distance;
    if (!arena.blocked(x, z, 3.2)) return out.set(x, 0, z);
  }
  return out.set(0, 0, minDistance);
}

/** 每帧复用的临时向量（避免热路径分配） */
const scratch = {
  aim: new Vec3(0, 0.06, 0),
  position: new Vec3(),
  other: new Vec3(),
  target: new Vec3(),
};

/** 鼠标射线与地面的交点（朝上/超范围时退化为“坦克正前方”） */
function updateAimPoint(): void {
  raycaster.setFromCamera(camera, pointerNdc.x, pointerNdc.y);
  const origin = raycaster.ray.origin;
  const direction = raycaster.ray.direction;
  if (direction.y < -1e-4) {
    const t = (0.06 - origin.y) / direction.y;
    if (t > 0 && t < 200) {
      scratch.aim.set(origin.x + direction.x * t, 0.06, origin.z + direction.z * t);
      return;
    }
  }
  player.getPosition(scratch.position);
  scratch.aim.set(scratch.position.x, 0.06, scratch.position.z);
}

const playerInput: TankInput = { drive: 0, turn: 0, turretYaw: null, fire: false };

function readPlayerInput(): TankInput {
  if (!player.alive) return NO_INPUT;
  const forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
  const turn = (keys.has("KeyA") ? 1 : 0) - (keys.has("KeyD") ? 1 : 0);
  updateAimPoint();
  player.getPosition(scratch.position);
  playerInput.drive = clamp(forward, -1, 1);
  playerInput.turn = clamp(turn, -1, 1);
  playerInput.turretYaw = Math.atan2(-(scratch.aim.x - scratch.position.x), -(scratch.aim.z - scratch.position.z));
  playerInput.fire = keys.has("Space") || keys.has("ShiftLeft") ? keys.has("Space") : fireQueued || pointerDown;
  fireQueued = false;
  return playerInput;
}

// ---- AI ---------------------------------------------------------------------
function updateAi(tank: Tank, dt: number): TankInput {
  const ai = aiStates.get(tank)!;
  tank.getPosition(scratch.position);
  player.getPosition(scratch.other);
  const distance = Math.hypot(scratch.other.x - scratch.position.x, scratch.other.z - scratch.position.z);
  ai.think -= dt;
  ai.nextFire -= dt;

  if (player.alive && distance < 34) ai.mode = "engage";
  else if (ai.mode === "engage" && (!player.alive || distance > 44)) ai.mode = "patrol";

  if (ai.think <= 0) {
    ai.think = 1.2 + random() * 1.6;
    if (ai.mode === "patrol") {
      for (let i = 0; i < 6; i++) {
        const x = (random() * 2 - 1) * (arena.halfSize - 6);
        const z = (random() * 2 - 1) * (arena.halfSize - 6);
        if (!arena.blocked(x, z, tank.radius + 1.5)) {
          ai.targetX = x;
          ai.targetZ = z;
          break;
        }
      }
    }
  }

  // 目标朝向：交战时盯玩家，否则去巡逻点
  let desiredYaw: number;
  let drive: number;
  if (ai.mode === "engage" && player.alive) {
    desiredYaw = Math.atan2(-(scratch.other.x - scratch.position.x), -(scratch.other.z - scratch.position.z));
    drive = distance > 20 ? 1 : distance < 12 ? -1 : 0;
    // 距离合适时侧向游走（避免站桩）
    if (drive === 0) drive = 0.35;
  } else {
    desiredYaw = Math.atan2(-(ai.targetX - scratch.position.x), -(ai.targetZ - scratch.position.z));
    drive = 1;
  }

  let yawDelta = desiredYaw - tank.getYaw();
  while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
  while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
  const turn = clamp(yawDelta * 2.2, -1, 1);
  if (Math.abs(yawDelta) > 0.9) drive *= 0.35;

  // 炮塔瞄准（带精度误差）+ 开火条件
  const aimError = (1 - state.enemyAccuracy) * 0.32 * (random() * 2 - 1);
  const turretYaw = desiredYaw + aimError;
  let turretDelta = turretYaw - tank.turretYaw;
  while (turretDelta > Math.PI) turretDelta -= Math.PI * 2;
  while (turretDelta < -Math.PI) turretDelta += Math.PI * 2;
  const aligned = Math.abs(turretDelta) < 0.1;
  const fire = ai.mode === "engage" && player.alive && aligned && tank.canFire() && ai.nextFire <= 0;
  if (fire) ai.nextFire = state.enemyFireDelay + random() * 0.8;

  return { drive: clamp(drive, -1, 1), turn, turretYaw, fire };
}

// ---- 命中处理 ---------------------------------------------------------------
let cameraShake = 0;

function handleHit(hit: ProjectileHit): void {
  if (hit.kind === "tank" && hit.tank) {
    const tank = hit.tank;
    const destroyed = tank.damage(hit.damage);
    effects.spawnExplosion(hit.position, tank === player ? 2.6 : 2.2);
    effects.spawnSpark(hit.position, 1.1);
    effects.spawnSmoke(hit.position, 1.8);
    cameraShake = Math.min(1, cameraShake + (tank === player ? 0.9 : 0.3));
    if (tank === player) game.hitMarker = 0.3;
    else game.hits++;
    if (destroyed) {
      tank.getCenter(scratch.other);
      effects.spawnExplosion(scratch.other, 5.2);
      effects.spawnSmoke(scratch.other, 4.2);
      cameraShake = 1;
      if (tank === player) {
        game.playerDeaths++;
        game.respawnIn = 2.5;
      } else {
        game.kills++;
        const index = enemies.indexOf(tank);
        window.setTimeout(() => {
          if (index >= 0 && enemies[index] === tank && tank !== player) spawnEnemy(tank, index, enemies.length);
        }, 4000);
      }
    }
    return;
  }
  if (hit.kind === "obstacle") {
    effects.spawnSpark(hit.position, 1.3);
    effects.spawnSmoke(hit.position, 1.1);
    return;
  }
  if (hit.kind === "ground") {
    effects.spawnExplosion(hit.position, 1.7);
    effects.spawnSmoke(hit.position, 1.4);
    player.getPosition(scratch.position);
    if (Math.hypot(hit.position.x - scratch.position.x, hit.position.z - scratch.position.z) < 7) {
      cameraShake = Math.max(cameraShake, 0.25);
    }
  }
}

// ---- 一帧逻辑 ---------------------------------------------------------------
function stepGame(dt: number, playerTankInput: TankInput): void {
  game.time += dt;

  // 玩家
  if (player.update(dt, playerTankInput, arena)) cameraShake = Math.max(cameraShake, 0.12);
  if (playerTankInput.fire) {
    const shot = player.fire();
    if (shot) {
      game.shots++;
      projectiles.spawn(shot.origin, shot.direction, player.options.shellSpeed, player, player.options.damage);
      effects.spawnFlash(shot.origin, 2.4);
      cameraShake = Math.max(cameraShake, 0.3);
    }
  }

  // 敌人
  for (const tank of enemies) {
    if (!tank.alive) continue;
    const aiInput = updateAi(tank, dt);
    tank.update(dt, aiInput, arena);
    if (aiInput.fire) {
      const shot = tank.fire();
      if (shot) {
        game.enemyShots++;
        projectiles.spawn(shot.origin, shot.direction, tank.options.shellSpeed, tank, tank.options.damage);
        effects.spawnFlash(shot.origin, 2.2);
      }
    }
  }

  // 炮弹（命中 → handleHit）
  projectiles.update(dt, arena, [player, ...enemies], (hit) => handleHit(hit));

  // 复活
  if (!player.alive) {
    game.respawnIn -= dt;
    if (game.respawnIn <= 0) {
      const spawn = freeSpawn(new Vec3(), 14);
      player.reset(spawn.x, spawn.z, random() * Math.PI * 2);
    }
  }
  if (game.hitMarker > 0) game.hitMarker = Math.max(0, game.hitMarker - dt);
  if (cameraShake > 0) cameraShake = Math.max(0, cameraShake - dt * 2.4);

  // 血条朝向相机 + 特效推进
  for (const tank of [player, ...enemies]) tank.faceCamera(cameraState.yaw);
  effects.update(dt, cameraState.yaw, camera.pitch);
}

/** 第三人称相机：跟随玩家 + 镜头抖动 */
function updateCamera(dt: number): void {
  player.getPosition(scratch.position);
  const targetYaw = state.freeLook ? cameraState.yaw : player.getYaw();
  let delta = targetYaw - cameraState.yaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const k = 1 - Math.pow(1 - clamp(state.cameraSmooth, 0.02, 1), dt * 60);
  cameraState.yaw += delta * k;
  cameraState.x += (scratch.position.x - cameraState.x) * k;
  cameraState.z += (scratch.position.z - cameraState.z) * k;

  const shake = cameraShake * 0.4;
  camera.center.set(
    cameraState.x + (random() * 2 - 1) * shake * 0.3,
    1.1 + (random() * 2 - 1) * shake * 0.2,
    cameraState.z + (random() * 2 - 1) * shake * 0.3,
  );
  camera.yaw = cameraState.yaw;
  camera.distance = state.cameraDistance;
  camera.pitch = degToRad(state.cameraPitch);
  camera.aspect = canvas.width / Math.max(1, canvas.height);
  camera.update();
}

// ---- 后处理 -----------------------------------------------------------------
const composer = new EffectComposer(device, {
  width: Math.max(1, canvas.width),
  height: Math.max(1, canvas.height),
  format: canvasFormat,
  sampleCount: state.msaa,
  label: "tank-postfx",
});
const bloomPass = new BloomPass(device, { threshold: 0.62, strength: 1.15, radius: 2.4, scale: 0.5, targetFormat: canvasFormat });
const tonemapPass = new ToneMapPass(device, { mode: "aces", exposure: 1.08, targetFormat: canvasFormat });
const vignettePass = new VignettePass(device, { strength: 0.42, softness: 0.75, targetFormat: canvasFormat });

function applyPostFx(): void {
  composer.passList.length = 0;
  if (state.bloom) composer.addPass(bloomPass);
  if (state.tonemap) composer.addPass(tonemapPass);
  if (state.vignette) composer.addPass(vignettePass);
}
applyPostFx();

// ---- HUD --------------------------------------------------------------------
const hud = document.createElement("div");
hud.id = "tank-hud";
hud.style.cssText =
  "position:fixed;left:12px;top:12px;color:#d7d9e0;font:12px/1.65 ui-monospace,Consolas,monospace;" +
  "background:rgba(12,14,20,.74);border:1px solid #2b3040;border-radius:8px;padding:10px 12px;z-index:20;white-space:pre;pointer-events:none";
document.body.appendChild(hud);

const crosshair = document.createElement("div");
crosshair.style.cssText =
  "position:fixed;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;z-index:19;pointer-events:none;" +
  "border:1px solid rgba(220,230,255,.55);border-radius:50%;transition:transform .08s,border-color .08s";
document.body.appendChild(crosshair);

const banner = document.createElement("div");
banner.style.cssText =
  "position:fixed;left:50%;top:20%;transform:translateX(-50%);z-index:20;color:#ffd27a;font:600 22px/1.4 system-ui;" +
  "text-shadow:0 2px 10px rgba(0,0,0,.9);pointer-events:none;opacity:0;transition:opacity .25s";
document.body.appendChild(banner);
let bannerTimer = 0;

function updateHud(fps: number): void {
  const bar = (ratio: number, width = 18): string => {
    const filled = Math.round(clamp(ratio, 0, 1) * width);
    return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
  };
  const hpRatio = player.hp / player.options.maxHp;
  const reload = player.cooldown > 0 ? 1 - player.cooldown / player.options.reloadTime : 1;
  const alive = enemies.filter((t) => t.alive).length;
  hud.textContent =
    `backend : ${device.kind}    fps ${fps}\n` +
    `血量    : [${bar(hpRatio)}] ${Math.round(player.hp)}/${player.options.maxHp}\n` +
    `装填    : [${bar(reload, 14)}] ${player.cooldown > 0 ? `${player.cooldown.toFixed(1)}s` : "就绪"}\n` +
    `战绩    : 击毁 ${game.kills} · 命中 ${game.hits}/${game.shots} · 被击毁 ${game.playerDeaths}\n` +
    `敌人    : ${alive}/${enemies.length} 存活 · 在飞炮弹 ${projectiles.activeCount} · 特效 ${effects.count}\n` +
    `统计    : 绘制 ${sceneRenderer.stats.drawn} · 剔除 ${sceneRenderer.stats.culled} · 三角形 ${sceneRenderer.stats.triangles}\n` +
    (player.alive ? "" : `复活倒计时 ${game.respawnIn.toFixed(1)}s\n`) +
    `操作    : W/S 前进后退 · A/D 转向 · 鼠标瞄准 · 空格/左键开火 · R 重开`;
  crosshair.style.borderColor = game.hitMarker > 0 ? "rgba(255,120,120,.95)" : "rgba(220,230,255,.55)";
  crosshair.style.transform = game.hitMarker > 0 ? "scale(1.4)" : "scale(1)";
}

function flashBanner(text: string): void {
  banner.textContent = text;
  banner.style.opacity = "1";
  bannerTimer = 1.5;
}

// ---- lil-gui 参数面板 -------------------------------------------------------
const gui = createGui({ title: "坦克世界", params });
const gameFolder = gui.addFolder("游戏");
gameFolder.add(state, "paused").name("暂停");
gameFolder
  .add(state, "enemies", 0, 8, 1)
  .name("敌人数")
  .onChange(() => rebuildEnemies());
gameFolder
  .add(state, "playerSpeed", 4, 24, 0.5)
  .name("玩家速度")
  .onChange(() => (player.options.speed = state.playerSpeed));
gameFolder
  .add(state, "damage", 5, 100, 1)
  .name("玩家伤害")
  .onChange(() => (player.options.damage = state.damage));
gameFolder
  .add(state, "reload", 0.2, 3, 0.05)
  .name("装填时间")
  .onChange(() => (player.options.reloadTime = state.reload));
gameFolder.add(state, "enemySpeed", 2, 18, 0.5).name("敌人速度");
gameFolder.add(state, "enemyAccuracy", 0.2, 1, 0.02).name("敌人精度");
gameFolder.add(state, "timeScale", 0.15, 1.6, 0.05).name("时间缩放（慢动作）");
gameFolder.add({ 重开一局: () => game.restart() }, "重开一局").name("重开一局");
gameFolder.open();

const qualityFolder = gui.addFolder("画质");
qualityFolder.add(state, "shadows").name("阴影").onChange(applyShadowSettings);
qualityFolder
  .add(state, "shadowMapSize", { "512": 512, "1024": 1024, "2048": 2048 })
  .name("阴影贴图")
  .onChange(applyShadowSettings);
qualityFolder
  .add(state, "msaa", { 关: 1, "4x": 4 })
  .name("MSAA")
  .onChange(() => composer.setSampleCount(state.msaa));
qualityFolder.add(state, "postfx").name("后处理链");
qualityFolder.add(state, "bloom").name("泛光").onChange(applyPostFx);
qualityFolder.add(state, "tonemap").name("色调映射").onChange(applyPostFx);
qualityFolder.add(state, "vignette").name("暗角").onChange(applyPostFx);
qualityFolder.add(bloomPass, "strength", 0, 3, 0.05).name("泛光强度");
qualityFolder.add(bloomPass, "threshold", 0, 1, 0.01).name("泛光阈值");
qualityFolder.close();

const cameraFolder = gui.addFolder("相机");
cameraFolder
  .add(state, "cameraDistance", 6, 40, 0.5)
  .name("跟随距离")
  .onChange(() => (camera.distance = state.cameraDistance));
cameraFolder.add(state, "cameraPitch", 4, 70, 1).name("俯视角");
cameraFolder.add(state, "cameraSmooth", 0.02, 0.6, 0.01).name("平滑");
cameraFolder.add(state, "freeLook").name("自由视角（不跟车体）");
cameraFolder.close();

// ---- 自检 -------------------------------------------------------------------
const selfTest = params.get("selftest") !== "0";
let frames = 0;
let fpsAccum = 0;
let fpsFrames = 0;
let fps = 0;
let tested = false;
let frozen = false;

async function renderOffscreen(): Promise<Uint8Array> {
  const target = new RenderTarget(device, {
    width: canvas.width,
    height: canvas.height,
    format: canvasFormat,
    label: "tank-selftest",
  });
  if (state.shadows) shadowRenderer.renderAndSubmit(scene, camera, sceneRenderer);
  else shadowRenderer.clear();
  const encoder = device.createCommandEncoder("tank-selftest");
  const pass = encoder.beginRenderPass({
    label: "tank-selftest-scene",
    colorAttachments: [target.colorAttachment({ clearValue: { r: 0.03, g: 0.031, b: 0.043, a: 1 } })],
    depthStencilAttachment: target.depthAttachment(),
  });
  sceneRenderer.render(pass, scene, camera);
  pass.end();
  device.submit([encoder.finish()]);
  const pixels = await target.readPixels();
  target.dispose();
  return pixels;
}

function luma(pixels: Uint8Array, i: number): number {
  return (0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!) / 255;
}

function meanLuma(pixels: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4) sum += luma(pixels, i);
  return sum / (pixels.length / 4);
}

function diffRatio(a: Uint8Array, b: Uint8Array, threshold = 0.02): number {
  let differing = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.abs(luma(a, i) - luma(b, i)) > threshold) differing++;
  return differing / (a.length / 4);
}

/**
 * 确定性自检：脚本输入 + 固定步长驱动游戏逻辑，检查
 * 移动 / 开火 / 命中 / 击毁 / AI 反击 / 特效 / 渲染 / 阴影 是否真的在工作。
 */
async function runSelfTest(): Promise<void> {
  frozen = true;
  const restore = { enemies: state.enemies, paused: state.paused, accuracy: state.enemyAccuracy, shadows: state.shadows };
  state.paused = false;
  state.enemies = 2;
  state.enemyAccuracy = 0.95;
  game.restart();
  // 固定射击位（朝 -Z）并把敌人放在正前方：脚本射击必定有清晰弹道
  player.reset(0, 14, 0);
  for (let i = 0; i < enemies.length; i++) {
    enemies[i]!.reset((i - 0.5) * 7, 2, 0);
  }
  const dt = 1 / 60;
  player.getPosition(scratch.position);
  const startX = scratch.position.x;
  const startZ = scratch.position.z;
  const startKills = game.kills;

  // 阶段 1：前进 1 秒
  for (let i = 0; i < 60; i++) stepGame(dt, { drive: 1, turn: 0, turretYaw: 0, fire: false });
  player.getPosition(scratch.position);
  const moved = Math.hypot(scratch.position.x - startX, scratch.position.z - startZ);

  // 阶段 2：回到射击位，瞄准敌人并持续开火 4 秒（同时观察 AI 是否反击）
  player.reset(0, 14, 0);
  let enemyHpDrop = 0;
  let maxEffects = 0;
  let maxShells = 0;
  const enemyShots0 = game.enemyShots;
  for (let i = 0; i < 240; i++) {
    const target = enemies.find((t) => t.alive) ?? null;
    let turretYaw = player.turretYaw;
    if (target) {
      target.getPosition(scratch.other);
      player.getPosition(scratch.position);
      turretYaw = Math.atan2(-(scratch.other.x - scratch.position.x), -(scratch.other.z - scratch.position.z));
      enemyHpDrop = Math.max(enemyHpDrop, target.options.maxHp - target.hp);
    }
    stepGame(dt, { drive: target ? 0.3 : 0, turn: 0, turretYaw, fire: true });
    maxEffects = Math.max(maxEffects, effects.count);
    maxShells = Math.max(maxShells, projectiles.activeCount);
  }
  const aiShots = game.enemyShots - enemyShots0;

  // 渲染两帧（开/关阴影）证明渲染链路与阴影都工作
  state.shadows = true;
  const withShadows = await renderOffscreen();
  state.shadows = false;
  const withoutShadows = await renderOffscreen();
  const shadowDiff = diffRatio(withShadows, withoutShadows);

  const result = {
    backend: device.kind,
    moved: Number(moved.toFixed(2)),
    shots: game.shots,
    hits: game.hits,
    kills: game.kills,
    enemyHpDrop: Number(enemyHpDrop.toFixed(1)),
    enemyShots: aiShots,
    playerHp: Number(player.hp.toFixed(1)),
    maxShells,
    maxEffects,
    meanLuma: Number(meanLuma(withShadows).toFixed(4)),
    shadowDiff: Number(shadowDiff.toFixed(4)),
    moveOk: moved > 4,
    fireOk: game.shots > 2,
    hitOk: game.hits > 0 && enemyHpDrop > 20,
    killOk: game.kills > startKills,
    aiOk: aiShots > 0,
    effectOk: maxEffects > 0 && maxShells > 0,
    renderOk: meanLuma(withShadows) > 0.02,
    shadowOk: shadowDiff > 0.002,
  };

  state.enemies = restore.enemies;
  state.paused = restore.paused;
  state.enemyAccuracy = restore.accuracy;
  state.shadows = restore.shadows;
  game.restart();
  frozen = false;
  console.log("TANK_SELFTEST " + JSON.stringify(result));
}

// ---- 主循环 -----------------------------------------------------------------
function frame(): void {
  const rawDt = 1 / 60;
  frames++;
  status.frames = frames;
  fpsAccum += rawDt;
  fpsFrames++;
  if (fpsAccum >= 0.4) {
    fps = Math.round(fpsFrames / fpsAccum);
    fpsAccum = 0;
    fpsFrames = 0;
  }
  if (bannerTimer > 0) {
    bannerTimer = Math.max(0, bannerTimer - rawDt);
    if (bannerTimer === 0) banner.style.opacity = "0";
  }

  if (renderer.resizeToDisplaySize(2)) {
    camera.aspect = canvas.width / Math.max(1, canvas.height);
    if (composer.width !== canvas.width || composer.height !== canvas.height) composer.resize(canvas.width, canvas.height);
  }

  if (!frozen && !state.paused) {
    const wasAlive = player.alive;
    const dt = clamp(rawDt * state.timeScale, 0, 0.05);
    stepGame(dt, readPlayerInput());
    if (wasAlive && !player.alive) flashBanner("被击毁！2.5 秒后复活");
    updateCamera(dt);
  } else {
    camera.update();
  }

  // 阴影 pass 必须独立提交（WebGPU 不允许同一 submit 内既写又读同一张纹理）
  if (state.shadows) shadowRenderer.renderAndSubmit(scene, camera, sceneRenderer);
  else shadowRenderer.clear();

  if (state.postfx) {
    composer.render((pass) => sceneRenderer.render(pass, scene, camera));
  } else {
    const pass = renderer.beginFrame();
    sceneRenderer.render(pass, scene, camera);
    renderer.endFrame();
  }
  updateHud(fps);
}

function loop(): void {
  try {
    frame();
  } catch (e) {
    status.err = e instanceof Error ? (e.stack ?? e.message) : String(e);
    console.log("TANK_ERROR " + status.err);
  }
  if (selfTest && !tested && frames === 25) {
    tested = true;
    void runSelfTest().catch((e) => console.log("TANK_SELFTEST_ERROR " + (e instanceof Error ? e.message : String(e))));
  }
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
