import { nativeImage } from 'electron';

const samples = 4;

// Electron bitmaps use premultiplied BGRA on every desktop platform Avi ships for.
function paintBadge(bitmap, width, left, top, diameter, color) {
  const red = parseInt(color.slice(1, 3), 16);
  const green = parseInt(color.slice(3, 5), 16);
  const blue = parseInt(color.slice(5, 7), 16);

  for (let y = 0; y < diameter; y += 1) {
    for (let x = 0; x < diameter; x += 1) {
      let ring = 0;
      let fill = 0;
      let glyph = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const u = (x + (sx + 0.5) / samples) / diameter;
          const v = (y + (sy + 0.5) / samples) / diameter;
          const center = Math.hypot(u - 0.5, v - 0.5);
          if (center > 0.5) continue;
          if (center > 0.44) {
            ring += 1;
            continue;
          }
          const head = Math.hypot(u - 0.5, v - 0.39) <= 0.15;
          const body = v >= 0.6 && Math.hypot(u - 0.5, v - 0.92) <= 0.3;
          if (head || body) glyph += 1;
          else fill += 1;
        }
      }
      const total = samples * samples;
      const white = (ring + glyph) / total;
      const tinted = fill / total;
      const alpha = white + tinted;
      if (alpha === 0) continue;

      const offset = ((top + y) * width + left + x) * 4;
      const keep = 1 - alpha;
      bitmap[offset] = Math.round(255 * white + blue * tinted + bitmap[offset] * keep);
      bitmap[offset + 1] = Math.round(255 * white + green * tinted + bitmap[offset + 1] * keep);
      bitmap[offset + 2] = Math.round(255 * white + red * tinted + bitmap[offset + 2] * keep);
      bitmap[offset + 3] = Math.round(255 * alpha + bitmap[offset + 3] * keep);
    }
  }
}

export function createProfileBadge(color, size = 32) {
  const bitmap = Buffer.alloc(size * size * 4);
  paintBadge(bitmap, size, 0, 0, size, color);
  return nativeImage.createFromBitmap(bitmap, { width: size, height: size });
}

export function createProfileAppIcon(iconPath, color, size = 256) {
  const base = nativeImage.createFromPath(iconPath).resize({ width: size, height: size, quality: 'best' });
  const bitmap = Buffer.from(base.toBitmap());
  const diameter = Math.round(size * 0.5);
  paintBadge(bitmap, size, size - diameter, size - diameter, diameter, color);
  return nativeImage.createFromBitmap(bitmap, { width: size, height: size });
}
