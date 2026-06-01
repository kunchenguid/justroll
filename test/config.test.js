import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG, expandHome, mergeConfig } from '../src/config.js';

test('expandHome resolves ~', () => {
  assert.equal(expandHome('~'), os.homedir());
  assert.equal(expandHome('~/Recordings'), path.join(os.homedir(), 'Recordings'));
  assert.equal(expandHome('/abs/path'), '/abs/path');
});

test('mergeConfig lets user override and merges nested one level', () => {
  const merged = mergeConfig(DEFAULT_CONFIG, { remuxToMp4: false, video: { fps: 60 } });
  assert.equal(merged.remuxToMp4, false);
  assert.equal(merged.video.fps, 60);
  // untouched nested keys survive
  assert.equal(merged.video.codec, 'h264_videotoolbox');
  assert.equal(merged.video.container, 'mkv');
});

test('defaults ship with mp4 remux on and Rode mic', () => {
  assert.equal(DEFAULT_CONFIG.remuxToMp4, true);
  assert.equal(DEFAULT_CONFIG.defaults.mic, 'RODE NT-USB');
});
