import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DEFAULT_CONFIG, mergeConfig } from '../src/config.js';
import { buildPlan } from '../src/plan.js';
import { buildSessionManifest, buildNotesMarkdown } from '../src/session.js';

const config = mergeConfig(DEFAULT_CONFIG, { recordingsDir: '/tmp/rec' });
const mic = { index: 2, name: 'RODE NT-USB' };
const selected = [
  { type: 'screen', deviceIndex: 1, deviceName: 'Capture screen 0' },
  { type: 'camera', deviceIndex: 0, deviceName: 'USB3.0 HD Video Capture' },
];

function makePlan(overrides = {}) {
  return buildPlan({
    title: 'Leave Big Tech 2',
    selectedSources: selected,
    mic,
    config,
    date: new Date(2026, 5, 1),
    existsFn: () => false,
    ...overrides,
  });
}

test('buildPlan resolves dirs, files, and ffmpeg indexes', () => {
  const plan = makePlan();
  assert.equal(plan.dirName, '2026-06-01_leave-big-tech-2');
  assert.equal(plan.dir, '/tmp/rec/2026-06-01_leave-big-tech-2');
  assert.equal(plan.rawDir, path.join(plan.dir, 'raw'));
  assert.deepEqual(
    plan.sources.map((s) => s.fileName),
    ['screen-0.mkv', 'camera.mkv'],
  );
  assert.equal(plan.sources[0].videoIndex, 1);
  assert.equal(plan.sources[0].audioIndex, 2); // mic embedded in every file
  assert.equal(plan.sources[1].audioIndex, 2);
  assert.equal(plan.settings.remuxToMp4, true);
});

test('buildPlan disambiguates a taken directory', () => {
  const plan = makePlan({ existsFn: (n) => n === '2026-06-01_leave-big-tech-2' });
  assert.equal(plan.dirName, '2026-06-01_leave-big-tech-2-2');
});

test('buildPlan can skip the mic', () => {
  const plan = makePlan({ mic: null });
  assert.equal(plan.mic, null);
  assert.equal(plan.sources[0].audioIndex, null);
});

test('session manifest summarizes sources', () => {
  const plan = makePlan();
  const m = buildSessionManifest(plan, {
    startedAt: 'a',
    endedAt: 'b',
    results: [{ label: 'screen-0', bytes: 100, seconds: 3, mp4: '/x.mp4' }],
  });
  assert.equal(m.tool, 'justroll');
  assert.equal(m.mic, 'RODE NT-USB');
  assert.equal(m.sources[0].bytes, 100);
  assert.equal(m.sources[0].mp4, '/x.mp4');
});

test('notes markdown contains the sync-by-audio recipe', () => {
  const md = buildNotesMarkdown(makePlan());
  assert.match(md, /sync/i);
  assert.match(md, /screen-0\.mkv/);
  assert.match(md, /RODE NT-USB/);
});
