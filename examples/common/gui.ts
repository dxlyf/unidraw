/**
 * 示例统一的参数面板（基于 [lil-gui](https://lil-gui.georgealways.com/)）。
 *
 * 约定：
 * - **左上角**留给示例的文字 HUD（后端 / fps / 统计），**右上角**是 lil-gui 面板；
 * - 面板风格与示例深色主题一致（CSS 变量覆盖 lil-gui 默认主题）；
 * - URL 参数作为初始值，面板改动立即生效（两者不互相覆盖）；
 * - `?gui=0` 可以完全关掉面板（截图/无头回归用），`?gui=closed` 默认收起。
 *
 * ```ts
 * const gui = createGui({ title: "后处理" });
 * const state = { bloom: true, strength: 1.1 };
 * applyUrlOverrides(state, params);
 * gui.add(state, "bloom").name("泛光");
 * gui.add(state, "strength", 0, 3, 0.01).name("强度").onChange(apply);
 * ```
 */

import GUI from "lil-gui";

export { default as GUI } from "lil-gui";

export interface DemoGuiOptions {
  title?: string;
  /** 面板宽度（默认 288） */
  width?: number;
  /** 面板放左侧（默认 false = 右侧，避免和 HUD 重叠） */
  left?: boolean;
  /** 默认收起 */
  closed?: boolean;
  /** 面板距顶部/侧边的像素（默认 12 / 12） */
  offset?: { x?: number; y?: number };
  /** 从 URL 读取初始展开状态（`?gui=0` 关闭 / `?gui=closed` 收起） */
  params?: URLSearchParams;
}

const STYLE_ID = "unidraw-gui-style";

/** 注入一次面板样式（深色 + 与示例 HUD 同款字体） */
function ensureStyle(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .lil-gui.root {
      --background-color: rgba(16,18,26,.86);
      --widget-color: #232837;
      --hover-color: #2e3548;
      --focus-color: #3a4256;
      --number-color: #8fd0ff;
      --string-color: #9ce39c;
      --title-background-color: rgba(32,37,52,.95);
      --selected-color: rgba(76,141,255,.85);
      --text-color: #d7d9e0;
      --font-size: 12px;
      --padding: 6px;
      --spacing: 5px;
      --input-font-size: 12px;
      --scrollbar-width: 6px;
      font-family: ui-monospace, Consolas, monospace;
      border: 1px solid #2b3040;
      border-radius: 8px;
      overflow: hidden;
      z-index: 30;
      backdrop-filter: blur(2px);
    }
    .lil-gui.root > .children { max-height: min(72vh, 620px); }
    .lil-gui .title { font-weight: 600; letter-spacing: .02em; }
    .lil-gui button { border-radius: 4px; }
    .lil-gui .controller.number .value { min-width: 42px; }
  `;
  document.head.appendChild(style);
}

/**
 * 创建统一风格的 lil-gui 面板。
 *
 * `?gui=0` 时返回一个**不挂到 DOM** 的 GUI（配置照常生效，只是不可见），
 * 这样示例代码不需要分支。
 */
export function createGui(options: DemoGuiOptions = {}): GUI {
  ensureStyle();
  const params = options.params ?? (typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams());
  const mode = params.get("gui");
  const gui = new GUI({ title: options.title ?? "参数", width: options.width ?? 288 });
  gui.domElement.style.position = "fixed";
  gui.domElement.style.top = `${options.offset?.y ?? 12}px`;
  gui.domElement.style[options.left ? "left" : "right"] = `${options.offset?.x ?? 12}px`;
  gui.domElement.style.zIndex = "30";
  if (options.closed || mode === "closed") gui.close();
  if (mode === "0") gui.hide();
  return gui;
}

/** 用 URL 参数覆盖 state 里的同名字段（只覆盖已存在的键，避免拼错参数就多出属性） */
export function applyUrlOverrides<T extends Record<string, unknown>>(state: T, params: URLSearchParams): T {
  for (const key of Object.keys(state)) {
    if (!params.has(key)) continue;
    const raw = params.get(key)!;
    const current = state[key];
    if (typeof current === "number") {
      const value = Number(raw);
      if (Number.isFinite(value)) (state as Record<string, unknown>)[key] = value;
    } else if (typeof current === "boolean") {
      (state as Record<string, unknown>)[key] = raw !== "0" && raw !== "false";
    } else if (typeof current === "string") {
      (state as Record<string, unknown>)[key] = raw;
    }
  }
  return state;
}

/** 面板里的按钮（一行多个） */
export function addButtons(
  gui: GUI,
  label: string,
  buttons: Record<string, () => void>,
): GUI {
  const folder = gui.addFolder(label);
  for (const [name, action] of Object.entries(buttons)) folder.add({ [name]: action }, name).name(name);
  return folder;
}
