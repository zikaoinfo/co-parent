// Génère les icônes PWA (public/icons) sans aucune dépendance : dessin dans
// un buffer RGBA suréchantillonné 4x puis encodage PNG maison (zlib natif).
// Usage : node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'icons');
const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

// Palette de l'app (voir src/styles.css).
const BG = [0x4f, 0x7c, 0xf0]; // bleu parent 1
const ACCENT = [0xef, 0x83, 0x54]; // orange parent 2
const WHITE = [0xff, 0xff, 0xff];

/** Dessine l'icône dans un canvas s×s (s = size × 4 pour l'anticrénelage). */
function draw(s) {
  const px = new Uint8Array(s * s * 4);
  const u = s / 100; // unité : pourcents du canvas

  const inRoundedRect = (x, y, rx, ry, rw, rh, r) => {
    if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) return false;
    const cx = Math.max(rx + r, Math.min(x, rx + rw - r));
    const cy = Math.max(ry + r, Math.min(y, ry + rh - r));
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r || (x >= rx + r && x < rx + rw - r) || (y >= ry + r && y < ry + rh - r);
  };
  const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let color = null;
      // Fond : carré arrondi plein cadre (zone sûre maskable : contenu centré).
      if (inRoundedRect(x, y, 0, 0, s, s, 18 * u)) color = BG;
      if (color) {
        // Corps du calendrier : carte blanche arrondie.
        if (inRoundedRect(x, y, 22 * u, 26 * u, 56 * u, 52 * u, 7 * u)) color = WHITE;
        // Bandeau supérieur orange.
        if (inRoundedRect(x, y, 22 * u, 26 * u, 56 * u, 14 * u, 7 * u) && y < 38 * u) color = ACCENT;
        // Anneaux de reliure.
        if (inRoundedRect(x, y, 32 * u, 18 * u, 4 * u, 12 * u, 2 * u)) color = WHITE;
        if (inRoundedRect(x, y, 64 * u, 18 * u, 4 * u, 12 * u, 2 * u)) color = WHITE;
        // Deux pastilles : les deux parents.
        if (inCircle(x, y, 39 * u, 58 * u, 8.5 * u)) color = BG;
        if (inCircle(x, y, 61 * u, 58 * u, 8.5 * u)) color = ACCENT;
      }
      const i = (y * s + x) * 4;
      if (color) {
        px[i] = color[0];
        px[i + 1] = color[1];
        px[i + 2] = color[2];
        px[i + 3] = 255;
      }
    }
  }
  return px;
}

/** Réduit le canvas 4x en moyennant (anticrénelage). */
function downsample(src, s, size) {
  const out = new Uint8Array(size * size * 4);
  const f = s / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sums = [0, 0, 0, 0];
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const i = ((y * f + dy) * s + x * f + dx) * 4;
          for (let c = 0; c < 4; c++) sums[c] += src[i + c];
        }
      }
      const o = (y * size + x) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = Math.round(sums[c] / (f * f));
    }
  }
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(px, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 6; // RGBA
  // Scanlines préfixées du filtre 0.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  // 4x par taille : facteur de réduction entier, anticrénelage propre.
  const png = encodePng(downsample(draw(size * 4), size * 4, size), size);
  writeFileSync(join(OUT, `icon-${size}x${size}.png`), png);
  console.log(`icon-${size}x${size}.png (${png.length} o)`);
}
