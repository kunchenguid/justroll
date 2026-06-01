import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { render } from 'ink-testing-library';
import { html } from '../src/ui/h.js';
import App from '../src/ui/App.js';
import { MockEngine } from '../src/ui/mockEngine.js';
import { MOCK_DEVICES } from '../src/ui/mockDevices.js';
import { DEFAULT_CONFIG } from '../src/config.js';

const strip = (s) => s.replace(/\[[0-9;]*m/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ESC = String.fromCharCode(27);

test('q quits from a mid-wizard step (app unmounts)', async () => {
  const config = { ...DEFAULT_CONFIG, recordingsDir: path.join(os.tmpdir(), 'justroll-q') };
  const { lastFrame, stdin, unmount } = render(
    html`<${App}
      title=${'X'}
      devices=${MOCK_DEVICES}
      config=${config}
      engine=${new MockEngine()}
    />`,
  );
  await sleep(50);
  stdin.write('\r');
  await sleep(40); // mic -> cameras (a step where esc wouldn't exit)
  assert.match(strip(lastFrame()), /Cameras/);
  stdin.write('q');
  await sleep(120);
  // on exit Ink unmounts and the frame clears
  assert.doesNotMatch(strip(lastFrame()), /Cameras|Microphone|Review/);
  unmount();
});

test('App mounts on the microphone step', async () => {
  const config = { ...DEFAULT_CONFIG, recordingsDir: path.join(os.tmpdir(), 'justroll-uitest') };
  const { lastFrame, unmount } = render(
    html`<${App}
      title=${'My Video'}
      devices=${MOCK_DEVICES}
      config=${config}
      engine=${new MockEngine()}
    />`,
  );
  await sleep(80);
  const f = strip(lastFrame());
  assert.match(f, /Step 1\/4/);
  assert.match(f, /Microphone/);
  assert.match(f, /RODE NT-USB/);
  unmount();
});

test('walking the wizard reaches a review with all three files', async () => {
  const config = { ...DEFAULT_CONFIG, recordingsDir: path.join(os.tmpdir(), 'justroll-uitest2') };
  const { lastFrame, stdin, unmount } = render(
    html`<${App}
      title=${'My Video'}
      devices=${MOCK_DEVICES}
      config=${config}
      engine=${new MockEngine()}
    />`,
  );
  await sleep(60);
  stdin.write(ESC + '[B');
  await sleep(30);
  stdin.write(ESC + '[B');
  await sleep(30); // select RODE
  stdin.write('\r');
  await sleep(30); // -> cameras
  stdin.write(' ');
  await sleep(30); // toggle camera
  stdin.write('\r');
  await sleep(30); // -> screens (screen-0 preselected)
  stdin.write(ESC + '[B');
  await sleep(30);
  stdin.write(' ');
  await sleep(30); // add screen 1
  stdin.write('\r');
  await sleep(40); // -> review
  const f = strip(lastFrame());
  assert.match(f, /Review/);
  assert.match(f, /screen-0\.mkv/);
  assert.match(f, /screen-1\.mkv/);
  assert.match(f, /camera\.mkv/);
  assert.match(f, /3 files/);
  assert.match(f, /Frame rate/);
  assert.match(f, /30 fps/);
  // review settings are navigable rows; the focused one (frame rate) changes with space/→
  stdin.write(' ');
  await sleep(40);
  assert.match(strip(lastFrame()), /48 fps/);
  // move down to the mp4 row and toggle it off
  stdin.write(ESC + '[B');
  await sleep(40);
  stdin.write(' ');
  await sleep(40);
  assert.match(strip(lastFrame()), /Remux to mp4/);
  unmount();
});
