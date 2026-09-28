// 生成扩展图标（128×128 PNG）。手写 PNG 编码器，不引第三方依赖。
// 图案就是扩展在做的事：一张「扩展 × 配置文件」的格子表，蓝＝启用、橙＝禁用、空心＝没装。
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 128;

/** 画布：RGBA */
const pixels = new Uint8Array(SIZE * SIZE * 4);

function set(x, y, [r, g, b, a = 255]) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) {
    return;
  }
  const i = (y * SIZE + x) * 4;
  pixels[i] = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
  pixels[i + 3] = a;
}

function fillRect(x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      set(x, y, color);
    }
  }
}

/** 圆角矩形背景 */
function fillRoundRect(x0, y0, w, h, radius, color) {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const dx = Math.max(x0 + radius - x, x - (x0 + w - 1 - radius), 0);
      const dy = Math.max(y0 + radius - y, y - (y0 + h - 1 - radius), 0);
      if (dx * dx + dy * dy <= radius * radius) {
        set(x, y, color);
      }
    }
  }
}

/** 空心方块（描边） */
function strokeRect(x0, y0, size, thickness, color) {
  fillRect(x0, y0, size, thickness, color);
  fillRect(x0, y0 + size - thickness, size, thickness, color);
  fillRect(x0, y0, thickness, size, color);
  fillRect(x0 + size - thickness, y0, thickness, size, color);
}

const BG = [30, 30, 30, 255];
const BLUE = [14, 99, 156, 255];
const ORANGE = [200, 145, 42, 255];
const DIM = [90, 90, 90, 255];
const LIGHT = [200, 200, 200, 255];

// 背景
fillRoundRect(0, 0, SIZE, SIZE, 22, BG);

// 左侧一列「扩展名」的示意条
const rowCount = 5;
const top = 26;
const rowGap = 4;
const rowH = 12;
for (let i = 0; i < rowCount; i += 1) {
  const y = top + i * (rowH + rowGap);
  fillRect(16, y, 26, rowH, i === 0 ? LIGHT : DIM);
}

// 右侧格子：列＝配置文件，格＝状态
const cell = 14;
const gap = 5;
const gridX = 52;
const states = [
  [BLUE, ORANGE, 'empty'],
  [BLUE, BLUE, ORANGE],
  ['empty', BLUE, BLUE],
  [BLUE, BLUE, BLUE],
  [ORANGE, 'empty', BLUE],
];
for (let r = 0; r < states.length; r += 1) {
  const y = top + r * (rowH + rowGap) - 1;
  for (let c = 0; c < states[r].length; c += 1) {
    const x = gridX + c * (cell + gap);
    const state = states[r][c];
    if (state === 'empty') {
      strokeRect(x, y, cell, 2, DIM);
    } else {
      fillRoundRect(x, y, cell, cell, 3, state);
    }
  }
}

// --- PNG 编码 ---

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

// 每行前面加一个 filter 字节（0 = None）
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0;
  Buffer.from(pixels.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.resolve(__dirname, '..', 'icon.png');
fs.writeFileSync(out, png);
console.log(`已生成 ${out}（${SIZE}×${SIZE}，${png.length} 字节）`);
