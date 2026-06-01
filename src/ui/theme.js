// One palette, one set of glyphs, one gradient - all using the terminal's own
// 16-color ANSI palette so justroll matches whatever colorscheme you run.
import chalk from 'chalk';

// Named ANSI colors (resolved by the terminal theme), not hardcoded RGB.
export const C = {
  rec: 'red',
  ok: 'green',
  warn: 'yellow',
  screen: 'cyan',
  camera: 'magenta',
  mic: 'yellow',
  dim: 'gray',
  text: 'white',
  bright: 'whiteBright',
  border: 'gray',
};

export const G = {
  dot: '●',
  ring: '◯',
  check: '◉',
  arrow: '❯',
  tick: '✓',
  cross: '✗',
  rec: '●',
  film: '⦿',
};

// Vertical waveform ramp: bottom green -> cyan -> magenta -> red peaks.
const RAMP = [
  [0.0, chalk.green],
  [0.4, chalk.cyan],
  [0.72, chalk.magenta],
  [0.9, chalk.red],
];

export function rampStyle(f) {
  const x = Math.max(0, Math.min(1, f));
  let fn = RAMP[0][1];
  for (const [t, c] of RAMP) if (x >= t) fn = c;
  return fn;
}

export function ramp(f, ch) {
  return rampStyle(f)(ch);
}

// Wordmark spread across a few bright ANSI colors.
const WORD = [chalk.greenBright, chalk.cyanBright, chalk.magentaBright];
export function gradientText(str) {
  const n = str.length;
  let out = '';
  for (let i = 0; i < n; i++) {
    const idx = Math.min(WORD.length - 1, Math.floor((i / Math.max(1, n - 1)) * WORD.length));
    out += WORD[idx](str[i]);
  }
  return out;
}

export const accentForType = (type) =>
  type === 'screen' ? C.screen : type === 'camera' ? C.camera : C.mic;

export { chalk };
