// Generates assets/icon.png: a 16x16 pixel-art robot scaled up to 1024px.
// Run: node scripts/make-icon.mjs && npm run icon
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const art = [
  "................",
  ".......yy.......",
  ".......yy.......",
  "........k.......",
  "...kkkkkkkkkk...",
  "..kooooooooook..",
  "..kowwwoowwwok..",
  "..kowckoowckok..",
  "..kooooooooook..",
  "..koodddddddok..",
  "..kooooooooook..",
  "...kkkkkkkkkk...",
  ".kbbbkssssbbbk..",
  ".kbbbkssssbbbk..",
  "..kk.kkkkkk.kk..",
  "................",
];
const pal = {
  ".": [16, 19, 31, 255], k: [20, 20, 36, 255], o: [239, 132, 71, 255],
  w: [255, 255, 255, 255], c: [64, 224, 208, 255], d: [120, 50, 40, 255],
  y: [255, 214, 90, 255], b: [90, 110, 170, 255], s: [160, 180, 230, 255],
};
const N = 16, S = 64, W = N * S;
const raw = Buffer.alloc((W * 4 + 1) * W);
for (let y = 0; y < W; y++) {
  raw[y * (W * 4 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    const c = pal[art[(y / S) | 0][(x / S) | 0]];
    raw.set(c, y * (W * 4 + 1) + 1 + x * 4);
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4);
ihdr[8] = 8; ihdr[9] = 6;
writeFileSync("assets/icon.png", Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
]));
console.log("wrote assets/icon.png");
