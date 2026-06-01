import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderWaveformRows } from '../src/ui/Waveform.js';

const strip = (s) => s.replace(/\[[0-9;]*m/g, '');

test('renderWaveformRows returns one string per row', () => {
  const rows = renderWaveformRows([0.5, 0.5, 0.5], 6, 5);
  assert.equal(rows.length, 5);
});

test('a full-amplitude column fills bottom to top', () => {
  const rows = renderWaveformRows([1], 1, 4).map(strip);
  assert.deepEqual(rows, ['█', '█', '█', '█']);
});

test('a quiet column only lights the bottom row', () => {
  const rows = renderWaveformRows([0.25], 1, 4).map(strip);
  assert.equal(rows[3], '█'); // bottom
  assert.equal(rows[0], ' '); // top is empty
});

test('newest samples are right-aligned with silence padding on the left', () => {
  const rows = renderWaveformRows([1], 3, 1).map(strip);
  assert.equal(rows[0], '  █'); // two pad columns then the full bar
});
