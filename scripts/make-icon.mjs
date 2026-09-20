import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const size = 256;

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

const rows = [];
for (let y = 0; y < size; y += 1) {
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x += 1) {
    const pad = 28;
    const on = x >= pad && x < size - pad && y >= pad && y < size - pad;
    if (!on) continue;
    const i = 1 + x * 4;
    row[i] = 240;
    row[i + 1] = 201;
    row[i + 2] = 77;
    row[i + 3] = 255;
  }
  rows.push(row);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk("IHDR", ihdr),
  pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
  pngChunk("IEND", Buffer.alloc(0)),
]);

const outDir = path.join(root, "build");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "icon.png"), png);
console.log("Icon geschrieben:", path.join(outDir, "icon.png"));
