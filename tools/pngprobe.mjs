// 极简 PNG 探针：解出像素，报告中心/整体是否含有“非背景”颜色
import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";

export function decodePng(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not png");
  let pos = 8;
  let w = 0;
  let h = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} unsupported`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 3 ? 1 : 4;
  const bpp = Math.max(1, (channels * bitDepth) / 8);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(w * h * channels);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= bpp && prev ? prev[x - bpp] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 255;
      cur[x] = v;
    }
  }
  return { width: w, height: h, channels, data: out };
}

const file = process.argv[2];
const { width, height, channels, data } = decodePng(file);
// 统计：全图非背景像素占比 + 中心区域亮度
function sample(cx, cy, rw, rh) {
  let minL = 255;
  let maxL = 0;
  let count = 0;
  let acc = 0;
  for (let y = cy; y < cy + rh; y++) {
    for (let x = cx; x < cx + rw; x++) {
      const i = (y * width + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (r + g + b > 40) count++;
      acc += l;
      minL = Math.min(minL, l);
      maxL = Math.max(maxL, l);
    }
  }
  return { bright: count, total: rw * rh, mean: acc / (rw * rh), min: minL, max: maxL };
}
const c = sample(Math.floor(width * 0.3), Math.floor(height * 0.3), Math.floor(width * 0.4), Math.floor(height * 0.4));
console.log(JSON.stringify({ width, height, channels, center: c }, null, 1));
