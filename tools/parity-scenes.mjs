// 一次性跑完 2D 一致性自检的全部场景（两个后端），结果从页面全局 `__parity` 读。
//
// 为什么不用控制台日志：页面加载比 CDP 连上还快，`PARITY_SELFTEST` 那行经常在
// `Runtime.enable` 之前就打完了，探针只能看到空白 —— 于是「测试通过」和「探针漏抓」
// 长得一模一样。走全局变量就没有这个竞态。
//
// 用法：
//   node tools/parity-scenes.mjs                 # 全部场景 × 两个后端
//   node tools/parity-scenes.mjs shadow,parity   # 只跑指定场景
//   $env:PARITY_MAP="1"                          # 额外打印差异热力图
import { execFileSync } from "node:child_process";

const ALL = ["parity", "fillrules", "extras", "composite", "image", "pattern", "stroke", "shadow", "shadow1"];
const scenes = process.argv[2] ? process.argv[2].split(",") : ALL;
const backends = (process.env.PARITY_BACKENDS ?? "webgl2,webgpu").split(",");
const BASE = process.env.PARITY_URL ?? "http://127.0.0.1:8095/_verify-2d-parity/index.html";
const wantMap = process.env.PARITY_MAP === "1";

const probe = (url, tag, expr) =>
  execFileSync(process.execPath, ["tools/browser-probe.mjs", url, tag], {
    encoding: "utf8",
    env: { ...process.env, PROBE_WAIT_MS: process.env.PROBE_WAIT_MS ?? "7000", DEBUG_EVAL: expr },
  });

const rows = [];
for (const backend of backends) {
  for (const scene of scenes) {
    const url = `${BASE}?backend=${backend}&msaa=4&scene=${scene}`;
    let text;
    try {
      text = probe(url, `${scene}-${backend}`, "JSON.stringify({ p: window.__parity ?? null, m: window.__parityMap ?? null })");
    } catch (e) {
      rows.push({ backend, scene, error: String(e).slice(0, 200) });
      continue;
    }
    const line = text.split(/\r?\n/).find((l) => l.startsWith("EVAL:"));
    const errors = (text.split(/\r?\n/).find((l) => l.startsWith("CONSOLE_ERRORS:")) ?? "?").trim();
    if (!line) {
      rows.push({ backend, scene, error: "no EVAL", errors });
      continue;
    }
    const parsed = JSON.parse(line.slice(5));
    if (!parsed.p) {
      const err = (text.split(/\r?\n/).find((l) => l.startsWith("RAW_ERR:")) ?? "").trim();
      rows.push({ backend, scene, error: `no __parity ${err}`, errors });
      continue;
    }
    rows.push({ backend, scene, ...parsed.p, errors, map: parsed.m });
  }
}

const pad = (s, n) => String(s).padEnd(n);
for (const r of rows) {
  if (r.error) {
    console.log(`${pad(r.backend, 7)} ${pad(r.scene, 10)} FAILED  ${r.error}  [${r.errors}]`);
    continue;
  }
  const regions = Object.entries(r.regions)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(
    `${pad(r.backend, 7)} ${pad(r.scene, 10)} mean=${String(r.mean).padStart(6)} >16=${String(r.over16).padStart(5)}% >48=${String(r.over48).padStart(5)}%  ${regions}  [${r.errors}]`,
  );
  if (wantMap && r.map) for (const l of r.map) console.log("    " + l.replace(/^PARITY_MAP /, ""));
}
