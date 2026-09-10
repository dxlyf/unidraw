// 开发用图像统计工具：把 PNG 转成文本亮度网格 + 连通亮块统计。
//
// 为什么需要它：无头验证时把截图变成「可读的数字」，
// 可以在不看图的情况下判断「多个物体是否真的画在不同位置」。
//
// 用法：
//   node tools/imgstats.mjs shot.png [--cols 48] [--rows 20] [--threshold 40]
import { decodePng } from "./pngprobe.mjs";

const file = process.argv[2];
if (!file) {
  console.error("用法: node tools/imgstats.mjs <png> [--cols N] [--rows N] [--threshold N]");
  process.exit(1);
}
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const cols = argOf("cols", 48);
const rows = argOf("rows", 20);
const threshold = argOf("threshold", 40);

const { width, height, channels, data } = decodePng(file);
const cell = (cx, cy) => {
  const x0 = Math.floor((cx * width) / cols);
  const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / cols));
  const y0 = Math.floor((cy * height) / rows);
  const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / rows));
  let acc = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * channels;
      acc += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      n++;
    }
  }
  return acc / Math.max(1, n);
};

const ramp = " .:-=+*#%@";
const grid = [];
for (let cy = 0; cy < rows; cy++) {
  let line = "";
  const rowValues = [];
  for (let cx = 0; cx < cols; cx++) {
    const l = cell(cx, cy);
    rowValues.push(l);
    line += ramp[Math.min(ramp.length - 1, Math.floor((l / 255) * ramp.length))];
  }
  grid.push({ line, rowValues });
}

// 亮块统计：按列聚合「显著亮于阈值」的像素，找连续亮区（粗粒度物体计数）
const colBright = new Array(cols).fill(0);
for (const { rowValues } of grid) {
  for (let cx = 0; cx < cols; cx++) if (rowValues[cx] > threshold) colBright[cx]++;
}
const runs = [];
let start = -1;
for (let cx = 0; cx <= cols; cx++) {
  const on = cx < cols && colBright[cx] > 0;
  if (on && start < 0) start = cx;
  if (!on && start >= 0) {
    runs.push([start, cx - 1]);
    start = -1;
  }
}
const meanL = grid.reduce((a, g) => a + g.rowValues.reduce((x, y) => x + y, 0), 0) / (cols * rows);

console.log(`# ${file} ${width}x${height}  meanL=${meanL.toFixed(2)}  threshold=${threshold}`);
console.log(grid.map((g) => g.line).join("\n"));
console.log(
  `# 亮列区间(${runs.length}): ` + runs.map(([a, b]) => `[${a}-${b}]`).join(" ") +
    (runs.length ? "" : " (无明显亮区)"),
);
console.log(
  `# 列亮度: ` + grid[0].rowValues.map((_, i) => Math.round(grid.reduce((a, g) => a + g.rowValues[i], 0) / rows)).join(","),
);
