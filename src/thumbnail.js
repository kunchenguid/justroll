// Render an RGB24 pixel buffer as half-block (▀) lines with 24-bit ANSI color.
// Two vertical pixels share one character cell - foreground paints the top pixel,
// background the bottom - which doubles vertical resolution in the terminal. Pure
// and deterministic so the wizard's per-screen thumbnails are unit-testable without
// ever spawning a capture.

const UPPER_HALF = '▀'; // ▀
const RESET = '[0m';
const BG_DEFAULT = '[49m';

const fg = (r, g, b) => `[38;2;${r};${g};${b}m`;
const bg = (r, g, b) => `[48;2;${r};${g};${b}m`;

// rgb: a row-major RGB24 buffer (3 bytes/pixel). Returns one string per pair of
// pixel rows; an odd final row keeps the terminal's default background.
export function renderRgbHalfBlocks(rgb, width, height) {
  if (!width || !height) return [];
  const at = (x, y) => {
    const i = (y * width + x) * 3;
    return [rgb[i] | 0, rgb[i + 1] | 0, rgb[i + 2] | 0];
  };
  const lines = [];
  for (let y = 0; y < height; y += 2) {
    let line = '';
    for (let x = 0; x < width; x++) {
      const [tr, tg, tb] = at(x, y);
      line += fg(tr, tg, tb);
      if (y + 1 < height) {
        const [br, bgc, bb] = at(x, y + 1);
        line += bg(br, bgc, bb);
      } else {
        line += BG_DEFAULT;
      }
      line += UPPER_HALF;
    }
    lines.push(line + RESET);
  }
  return lines;
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c);
  };
  return [f(0), f(8), f(4)];
}

// A deterministic, distinct gradient per seed - used by --demo so the thumbnail
// feature shows up without touching a real display.
export function syntheticThumbnail(seed, width = 24, height = 12) {
  const buf = Buffer.alloc(width * height * 3);
  const base = ((seed * 67) % 12) / 12; // distinct hue per screen
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      const [r, g, b] = hslToRgb((base + t / 3) % 1, 0.5, 0.4 + 0.15 * t);
      const i = (y * width + x) * 3;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
    }
  }
  return renderRgbHalfBlocks(buf, width, height);
}
