// 临时工具：只打包一个示例目录（用于验证用示例，不影响 build-examples 列表）
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)) + "/..";
const name = process.argv[2];
if (!name) {
  console.error("用法: node tools/_build-one.mjs <example-name>");
  process.exit(1);
}
const outdir = join(root, "dist-examples", name);
mkdirSync(outdir, { recursive: true });
await build({
  entryPoints: [join(root, "examples", name, "main.ts")],
  bundle: true,
  format: "esm",
  target: ["es2022"],
  outfile: join(outdir, "app.js"),
  sourcemap: true,
  logLevel: "error",
  tsconfig: join(root, "tsconfig.json"),
});
copyFileSync(join(root, "examples", name, "index.html"), join(outdir, "index.html"));
console.log(`✔ ${name}`);
