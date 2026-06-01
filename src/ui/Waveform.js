// The showpiece: a bottom-anchored, sub-cell, aurora-gradient scrolling level view.
// Each column is one audio frame; height is rendered with 1/8-cell precision and
// colored by vertical position so peaks light up hot.
import { html } from './h.js';
import { Box, Text } from 'ink';
import { rampStyle } from './theme.js';

const BLOCKS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

export function renderWaveformRows(values, width, height) {
  // values: array of 0..1, oldest..newest. Right-align newest; pad left with silence.
  const cols = new Array(width).fill(0);
  const start = Math.max(0, values.length - width);
  const slice = values.slice(start);
  const offset = width - slice.length;
  for (let i = 0; i < slice.length; i++) cols[offset + i] = slice[i];

  const rows = [];
  for (let r = 0; r < height; r++) {
    // r=0 top row, r=height-1 bottom row.
    const fromBottom = height - 1 - r;
    let line = '';
    for (let c = 0; c < width; c++) {
      const total = cols[c] * height; // cells filled from the bottom
      const fill = Math.max(0, Math.min(1, total - fromBottom));
      const ch = BLOCKS[Math.round(fill * 8)];
      if (ch === ' ') {
        line += ' ';
      } else {
        // color by vertical position: bottom rows green, peaks hot
        const f = height <= 1 ? 0 : fromBottom / (height - 1);
        line += rampStyle(f)(ch);
      }
    }
    rows.push(line);
  }
  return rows;
}

export function Waveform({ values, width = 60, height = 7 }) {
  const rows = renderWaveformRows(values, Math.max(8, width), height);
  return html`
    <${Box} flexDirection="column">
      ${rows.map((line, i) => html`<${Text} key=${i}>${line}</${Text}>`)}
    <//>
  `;
}
