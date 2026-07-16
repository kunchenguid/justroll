import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRgbHalfBlocks, syntheticThumbnail } from '../src/thumbnail.js';

const UPPER_HALF = '▀';

// rgb24 buffer helper: rows of [r,g,b] triples, row-major.
function rgb(pixels) {
  return Buffer.from(pixels.flat());
}

test('renderRgbHalfBlocks pairs two pixel rows into one cell (fg=top, bg=bottom)', () => {
  // 1 wide, 2 tall: top red, bottom blue -> one line, one ▀ cell.
  const buf = rgb([
    [255, 0, 0],
    [0, 0, 255],
  ]);
  const lines = renderRgbHalfBlocks(buf, 1, 2);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[38;2;255;0;0m/); // foreground = top pixel
  assert.match(lines[0], /\[48;2;0;0;255m/); // background = bottom pixel
  assert.equal((lines[0].match(/▀/g) || []).length, 1);
  assert.ok(lines[0].endsWith('[0m')); // reset at end of line
});

test('renderRgbHalfBlocks emits ceil(height/2) lines, width cells each', () => {
  const w = 3;
  const h = 5; // odd height
  const buf = Buffer.alloc(w * h * 3, 120);
  const lines = renderRgbHalfBlocks(buf, w, h);
  assert.equal(lines.length, Math.ceil(h / 2)); // 3 lines
  for (const line of lines) {
    assert.equal((line.match(new RegExp(UPPER_HALF, 'g')) || []).length, w);
  }
});

test('renderRgbHalfBlocks uses default background for an orphan bottom row', () => {
  // 1x1: only a top pixel, no bottom -> reset-bg (49), not a 48;2 color.
  const lines = renderRgbHalfBlocks(rgb([[10, 20, 30]]), 1, 1);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[49m/);
  assert.ok(!/\[48;2;/.test(lines[0]));
});

test('renderRgbHalfBlocks returns [] for empty dimensions', () => {
  assert.deepEqual(renderRgbHalfBlocks(Buffer.alloc(0), 0, 0), []);
  assert.deepEqual(renderRgbHalfBlocks(Buffer.alloc(0), 4, 0), []);
});

test('syntheticThumbnail produces distinct art per seed (for --demo)', () => {
  const a = syntheticThumbnail(0, 8, 4).join('\n');
  const b = syntheticThumbnail(1, 8, 4).join('\n');
  assert.notEqual(a, b);
  assert.equal(syntheticThumbnail(0, 8, 4).length, 2); // 4px tall -> 2 lines
});
