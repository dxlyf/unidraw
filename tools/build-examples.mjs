/**
 * 示例构建：esbuild 把每个 examples/<name>/main.ts 打包为
 * dist-examples/<name>/app.js，并复制 index.html 与生成首页。
 */

import { build } from "esbuild";
import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)) + "/..";

const demos = [
  { name: "triangle", title: "三角形 · 最小示例" },
  { name: "shapes", title: "形状 · 多几何体/深度/轨道相机" },
  { name: "textures", title: "纹理 · 采样/寻址" },
  { name: "instancing", title: "实例化 · 自定义着色器 + instance 顶点流" },
  { name: "shapes2d", title: "2D 绘制 · 矩形/线/圆/椭圆/多边形" },
  { name: "perf-drawcalls", title: "性能 · draw call 压力（500→6000 draws）" },
  { name: "perf-instanced", title: "性能 · 实例化压力（4k→262k）" },
  { name: "perf-triangles", title: "性能 · 三角形吞吐" },
];

for (const demo of demos) {
  const outdir = join(root, "dist-examples", demo.name);
  mkdirSync(outdir, { recursive: true });
  await build({
    entryPoints: [join(root, "examples", demo.name, "main.ts")],
    bundle: true,
    format: "esm",
    target: ["es2022"],
    outfile: join(outdir, "app.js"),
    sourcemap: true,
    logLevel: "info",
    tsconfig: join(root, "tsconfig.json"),
  });
  copyFileSync(join(root, "examples", demo.name, "index.html"), join(outdir, "index.html"));
  console.log(`✔ ${demo.name}`);
}

// 首页
const links = demos
  .map(
    (d, i) =>
      `<li><a href="./${d.name}/index.html">${i + 1}. ${d.title}</a>
       <span class="be"><a href="./${d.name}/index.html?backend=webgpu">WebGPU</a> ·
       <a href="./${d.name}/index.html?backend=webgl2">WebGL2</a></span></li>`,
  )
  .join("\n");

writeFileSync(
  join(root, "dist-examples", "index.html"),
  `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<title>UniDraw 示例</title>
<style>
body{font-family:system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#0b0c10;color:#d7d9e0;padding:32px;line-height:1.8}
a{color:#7aa2ff;text-decoration:none}a:hover{text-decoration:underline}
li{margin:8px 0}.be{font-size:12px;color:#6b7185;margin-left:10px}
small{color:#6b7185}</style></head>
<body>
<h2>UniDraw 示例（同一套源码同时跑 WebGL2 / WebGPU）</h2>
<ul>
${links}
</ul>
<small>需要 WebGPU 或 WebGL2 支持；WebGPU 优先，可 ?backend= 强制。构建：npm run build:examples · 本地预览：npm run serve。<br/>
性能示例会自动循环各档位（每档约 3s 测量窗口帧耗时，预热 12 帧）；点击档位可手动停留，空格暂停/继续。</small>
</body></html>
`,
);
console.log("✔ dist-examples/index.html");
