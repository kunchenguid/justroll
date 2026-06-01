// Drives the real App through every screen with the mock engine and saves each
// rendered frame (ANSI) to .preview/. Run: node scripts/capture.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { render } from 'ink-testing-library';
import { html } from '../src/ui/h.js';
import App from '../src/ui/App.js';
import { MockEngine } from '../src/ui/mockEngine.js';
import { MOCK_DEVICES } from '../src/ui/mockDevices.js';
import { DEFAULT_CONFIG } from '../src/config.js';

const ESC = String.fromCharCode(27);
const KEY = {
  up: ESC + '[A',
  down: ESC + '[B',
  enter: '\r',
  space: ' ',
  esc: ESC,
  ctrlc: String.fromCharCode(3),
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const outDir = path.join(process.cwd(), '.preview');
fs.mkdirSync(outDir, { recursive: true });
const stripAnsi = (s) => s.replace(new RegExp(ESC + '\\[[0-9;]*m', 'g'), '');

const config = { ...DEFAULT_CONFIG, recordingsDir: path.join(os.tmpdir(), 'justroll-demo') };

const { lastFrame, stdin, unmount } = render(
  html`<${App}
    title=${'Leave Big Tech 2'}
    devices=${MOCK_DEVICES}
    config=${config}
    engine=${new MockEngine()}
  />`,
);

const shots = [];
function shot(name) {
  const frame = lastFrame();
  fs.writeFileSync(path.join(outDir, `${name}.ansi`), frame);
  fs.writeFileSync(path.join(outDir, `${name}.txt`), stripAnsi(frame));
  shots.push(name);
}

await sleep(150);
shot('1-wizard-mic'); // RODE is pre-selected/highlighted (selection follows the highlight)
stdin.write(KEY.up);
await sleep(60);
shot('1b-wizard-mic-moved'); // highlight moved up = selection changed immediately
stdin.write(KEY.down);
await sleep(60); // back to RODE
stdin.write(KEY.enter); // -> cameras
await sleep(80);
shot('2a-wizard-cameras-unselected'); // cursor on an UNSELECTED camera -> "space to select"
stdin.write(KEY.space); // toggle the camera
await sleep(80);
shot('2-wizard-cameras'); // now selected -> "✓ selected"
stdin.write(KEY.enter); // -> screens
await sleep(80);
shot('3a-wizard-screens-initial'); // screen-0 preselected, cursor on it
stdin.write(KEY.down);
await sleep(60);
stdin.write(KEY.space); // add screen 1 too (screen 0 is preselected)
await sleep(80);
shot('3-wizard-screens');
stdin.write(KEY.enter); // -> review
await sleep(80);
shot('4-wizard-review');
stdin.write(KEY.enter); // start recording (mock)
await sleep(900);
shot('5-dashboard');
await sleep(600);
shot('5b-dashboard');
stdin.write(KEY.ctrlc); // stop & finalize
await sleep(1000);
shot('6-summary');

unmount();
console.log('saved frames:', shots.join(', '));
