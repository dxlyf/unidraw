/**
 * 示例构建：esbuild 把每个 examples/<name>/main.ts 打包为
 * dist-examples/<name>/app.js，并复制 index.html 与生成首页。
 */

import { build } from "esbuild";
import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)) + "/..";

/**
 * 内部验证页（`examples/_verify-*`）：不放进示例列表，但可以用
 * `npm run build:verify` 打包，配合 tools/browser-probe.mjs 做无头回归。
 */
const verifyPages = [
  { name: "_verify-shared", title: "验证 · 共享材质逐物体矩阵（动态偏移 UBO）" },
  { name: "_verify-sphere", title: "验证 · 极点无洞 + 离屏深度清除" },
  { name: "_verify-2d-clip", title: "验证 · 2D 合批与文本缓冲（WebGL2 索引绑定）" },
  { name: "_verify-2d-parity", title: "验证 · 与原生 Canvas2D 的逐像素对照" },
  { name: "_verify-texture-dims", title: "验证 · 3D / 2D 数组 / cube 纹理维度" },
];

const demos = [
  { name: "triangle", title: "三角形 · 最小示例" },
  { name: "shapes", title: "形状 · 多几何体/深度/轨道相机" },
  { name: "textures", title: "纹理 · 采样/寻址" },
  { name: "instancing", title: "实例化 · 自定义着色器 + instance 顶点流" },
  { name: "instanced-mesh", title: "InstancedMesh · 一次绘制 N 个实例（含与独立 Mesh 的逐像素对比）" },
  { name: "shapes2d", title: "2D 绘制 · 矩形/线/圆/椭圆/多边形" },
  { name: "shapes3d", title: "3D · 材质与几何画廊" },
  { name: "standard-material", title: "PBR · MeshStandardMaterial（metallic-roughness）" },
  { name: "blend", title: "混合模式 · blend/depthWrite/半透明排序" },
  { name: "tank-world", title: "示例游戏 · 坦克世界（AI/炮弹/阴影/后处理）" },
  { name: "picking", title: "拾取 · 射线几何命中 + GPU 颜色拾取" },
  { name: "animation", title: "动画 · 关键帧 / Mixer / Tween" },
  { name: "app", title: "应用 · App 门面 + 插件（轨道相机/拾取高亮/HUD）" },
  { name: "lights", title: "灯光 · 环境光/方向光/点光/聚光" },
  { name: "shadows", title: "阴影 · Shadow Map（方向光 + 聚光 + PCF）" },
  { name: "postfx", title: "后处理 · RenderTarget(MSAA)/Bloom/ToneMap/Vignette" },
  { name: "perf-drawcalls", title: "性能 · draw call 压力（500→40000 draws）" },
  { name: "perf-instanced", title: "性能 · 实例化压力（4k→262k）" },
  { name: "perf-triangles", title: "性能 · 三角形吞吐" },
];

const onlyVerify = process.argv.includes("--verify");
const list = onlyVerify ? verifyPages : demos;

for (const demo of list) {
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

if (onlyVerify) {
  console.log("✔ 验证页打包完成（未改动示例首页）");
  process.exit(0);
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
