// 临时探针：用 CDP 打开示例页，等待若干帧后抓取状态文本/控制台错误/截图
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";
const [url, tag] = process.argv.slice(2);
const port = 9227 + (Math.abs((tag ?? "").length * 7) % 50);

const profile = mkdtempSync(join(tmpdir(), `ud-${tag}-`));
const extra = process.env.EXTRA_CHROME_FLAGS ? process.env.EXTRA_CHROME_FLAGS.split(/\s+/) : [];
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--no-sandbox",
    ...extra,
    "--hide-scrollbars",
    "--window-size=520,420",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "--force-color-profile=srgb",
    url,
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listPages() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages = await r.json();
      const page = pages.find((p) => p.type === "page" && p.url.includes("index.html"));
      if (page) return page;
    } catch {
      /* chrome 未就绪 */
    }
    await sleep(300);
  }
  throw new Error("chrome page 未就绪");
}

const page = await listPages();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let msgId = 0;
const pending = new Map();
const consoleLines = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === "Runtime.consoleAPICalled") {
    const text = (msg.params.args ?? [])
      .map((a) => (a.value !== undefined ? String(a.value) : a.description ?? ""))
      .join(" ");
    consoleLines.push(`[console.${msg.params.type}] ${text}`);
  } else if (msg.method === "Runtime.exceptionThrown") {
    consoleLines.push("[exception] " + (msg.params.exceptionDetails?.text ?? ""));
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send("Runtime.enable");
await send("Page.enable");

// 等待若干帧
await sleep(Number(process.env.PROBE_WAIT_MS || 4500));

const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  return r.result?.result?.value;
};

const status = await evalJs(
  `JSON.stringify({
     backend: window.__unidraw?.status?.backend ?? null,
     err: window.__unidraw?.status?.err ?? "",
     fps: window.__unidraw?.status?.fps ?? "",
     size: window.__unidraw?.status?.size ?? null,
     frames: window.__unidraw?.status?.frames ?? 0
   })`,
);
const rawErr = await evalJs(`document.querySelector('#err')?.textContent ?? ""`);
const rawBackend = await evalJs(`document.querySelector('#backend')?.textContent ?? ""`);
const gpuInfo = await evalJs(
  `JSON.stringify({
     gpu: typeof navigator.gpu,
     ua: navigator.userAgent
   })`,
);

const shot = await send("Page.captureScreenshot", { format: "png" });
const b64 = shot.result?.data;
const outPng = `shot-${tag}.png`;
if (b64) writeFileSync(outPng, Buffer.from(b64, "base64"));
else console.log("SCREENSHOT_ERROR:", JSON.stringify(shot).slice(0, 500));

console.log("URL:", url);
console.log("STATUS:", status);
console.log("RAW_ERR:", rawErr || "(empty)");
console.log("RAW_BACKEND:", rawBackend || "(empty)");
console.log("GPU:", gpuInfo);
console.log("CONSOLE:");
console.log(consoleLines.slice(0, 40).join("\n") || "(none)");
console.log("SHOT:", b64 ? `${outPng} (${(b64.length * 0.75).toFixed(0)}B)` : "failed");

ws.close();
chrome.kill();
await sleep(600);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  /* chrome 可能仍占用临时目录，忽略 */
}
process.exit(0);
