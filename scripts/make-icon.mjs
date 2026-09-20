import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return ~crc >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function setPx(data, size, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= size || y >= size || a <= 0) return;
  const i = (y * size + x) * 4;
  const srcA = a / 255;
  const dstA = data[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  data[i] = Math.round((r * srcA + data[i] * dstA * (1 - srcA)) / outA);
  data[i + 1] = Math.round((g * srcA + data[i + 1] * dstA * (1 - srcA)) / outA);
  data[i + 2] = Math.round((b * srcA + data[i + 2] * dstA * (1 - srcA)) / outA);
  data[i + 3] = Math.round(outA * 255);
}

function fillRoundRect(data, size, x0, y0, x1, y1, radius, r, g, b, a) {
  const rad = Math.max(0, Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2));
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y += 1) {
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x += 1) {
      let dx = 0;
      let dy = 0;
      if (x < x0 + rad && y < y0 + rad) {
        dx = x0 + rad - x;
        dy = y0 + rad - y;
      } else if (x > x1 - rad && y < y0 + rad) {
        dx = x - (x1 - rad);
        dy = y0 + rad - y;
      } else if (x < x0 + rad && y > y1 - rad) {
        dx = x0 + rad - x;
        dy = y - (y1 - rad);
      } else if (x > x1 - rad && y > y1 - rad) {
        dx = x - (x1 - rad);
        dy = y - (y1 - rad);
      } else if (x < x0 || x > x1 || y < y0 || y > y1) {
        continue;
      }
      if (dx || dy) {
        const d = Math.sqrt(dx * dx + dy * dy);
        const cover = Math.min(1, Math.max(0, rad + 0.65 - d));
        if (cover <= 0) continue;
        setPx(data, size, x, y, r, g, b, Math.round(a * cover));
      } else {
        setPx(data, size, x, y, r, g, b, a);
      }
    }
  }
}

function drawSticky(data, size) {
  const s = size;
  const left = s * 0.16;
  const top = s * 0.12;
  const right = s * 0.84;
  const bottom = s * 0.88;
  const radius = s * 0.07;
  const fold = s * 0.22;
  const paper = [240, 201, 77];
  const paperHot = [255, 226, 122];
  const crease = [201, 162, 39];
  const ink = [110, 90, 32];

  fillRoundRect(
    data,
    s,
    left + s * 0.04,
    top + s * 0.05,
    right + s * 0.04,
    bottom + s * 0.05,
    radius,
    20,
    14,
    6,
    70,
  );
  fillRoundRect(data, s, left, top, right, bottom, radius, paper[0], paper[1], paper[2], 255);

  const foldX = right - fold;
  const foldY = top + fold;
  for (let y = Math.floor(top); y <= Math.ceil(foldY + 1); y += 1) {
    for (let x = Math.floor(foldX); x <= Math.ceil(right); x += 1) {
      const u = x - foldX;
      const v = y - top;
      const side = u + v - fold;
      if (side < -0.8) {
        setPx(data, s, x, y, 0, 0, 0, 0);
        const i = (y * s + x) * 4;
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 0;
      } else if (side < 1.4) {
        setPx(data, s, x, y, crease[0], crease[1], crease[2], 255);
      } else if (u > v * 0.15) {
        const t = Math.min(1, Math.max(0, (u - v) / fold));
        setPx(
          data,
          s,
          x,
          y,
          mix(paperHot[0], 232, t * 0.35),
          mix(paperHot[1], 196, t * 0.35),
          mix(paperHot[2], 96, t * 0.35),
          255,
        );
      }
    }
  }

  const tapeW = s * 0.22;
  const tapeH = s * 0.055;
  const tapeX0 = (left + right) / 2 - tapeW / 2;
  const tapeY0 = top - tapeH * 0.35;
  fillRoundRect(data, s, tapeX0, tapeY0, tapeX0 + tapeW, tapeY0 + tapeH, s * 0.02, 255, 248, 214, 210);

  const lineLeft = left + s * 0.12;
  const lineRight = foldX - s * 0.04;
  for (let n = 0; n < 4; n += 1) {
    const y = top + fold + s * 0.1 + n * s * 0.095;
    if (y > bottom - s * 0.12) break;
    for (let x = Math.floor(lineLeft); x <= Math.ceil(lineRight); x += 1) {
      setPx(data, s, x, Math.round(y), ink[0], ink[1], ink[2], 90);
      setPx(data, s, x, Math.round(y) + 1, ink[0], ink[1], ink[2], 40);
    }
  }
}

function downsample(src, srcSize, outSize) {
  const scale = srcSize / outSize;
  const out = Buffer.alloc(outSize * outSize * 4);
  for (let y = 0; y < outSize; y += 1) {
    for (let x = 0; x < outSize; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      const x0 = Math.floor(x * scale);
      const y0 = Math.floor(y * scale);
      const x1 = Math.floor((x + 1) * scale);
      const y1 = Math.floor((y + 1) * scale);
      for (let yy = y0; yy < y1; yy += 1) {
        for (let xx = x0; xx < x1; xx += 1) {
          const i = (yy * srcSize + xx) * 4;
          const aa = src[i + 3] / 255;
          r += src[i] * aa;
          g += src[i + 1] * aa;
          b += src[i + 2] * aa;
          a += aa;
          count += 1;
        }
      }
      const o = (y * outSize + x) * 4;
      if (a <= 0) continue;
      out[o] = Math.round(r / a);
      out[o + 1] = Math.round(g / a);
      out[o + 2] = Math.round(b / a);
      out[o + 3] = Math.round((a / count) * 255);
    }
  }
  return out;
}

export function buildIconPng(outSize = 256) {
  const srcSize = outSize * 2;
  const src = new Uint8Array(srcSize * srcSize * 4);
  drawSticky(src, srcSize);
  const pixels = downsample(src, srcSize, outSize);
  const rows = [];
  for (let y = 0; y < outSize; y += 1) {
    const row = Buffer.alloc(1 + outSize * 4);
    pixels.copy(row, 1, y * outSize * 4, (y + 1) * outSize * 4);
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(outSize, 0);
  ihdr.writeUInt32BE(outSize, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function writeAppIcon() {
  const outDir = path.join(root, "build");
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, "icon.png");
  writeFileSync(file, buildIconPng(256));
  return file;
}

const invoked = process.argv[1] && path.basename(process.argv[1]).includes("make-icon");
if (invoked) {
  console.log("Icon geschrieben:", writeAppIcon());
}
