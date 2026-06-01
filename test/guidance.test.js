import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { render } from 'ink-testing-library';
import { html } from '../src/ui/h.js';
import App from '../src/ui/App.js';
import { MockEngine } from '../src/ui/mockEngine.js';
import { DEFAULT_CONFIG } from '../src/config.js';

const strip = (s) => s.replace(/\[[0-9;]*m/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Devices with NO screens and NO cameras to trigger the inline guidance.
const SPARSE = { video: [], audio: [{ index: 2, name: 'RODE NT-USB' }] };

test('empty screen step shows Screen Recording guidance', async () => {
  const config = { ...DEFAULT_CONFIG, recordingsDir: path.join(os.tmpdir(), 'justroll-guide') };
  const { lastFrame, stdin, unmount } = render(
    html`<${App} title=${'X'} devices=${SPARSE} config=${config} engine=${new MockEngine()} />`,
  );
  await sleep(60);
  stdin.write('\r');
  await sleep(30); // mic -> cameras
  assert.match(strip(lastFrame()), /No cameras/);
  stdin.write('\r');
  await sleep(30); // cameras -> screens
  const f = strip(lastFrame());
  assert.match(f, /No screens detected/);
  assert.match(f, /Screen Recording/);
  unmount();
});
