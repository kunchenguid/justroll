import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeviceList, resolveDeviceIndex } from '../src/devices.js';

// Real output captured from this machine.
const SAMPLE = `
[AVFoundation indev @ 0x97ec1c140] AVFoundation video devices:
[AVFoundation indev @ 0x97ec1c140] [0] USB3.0 HD Video Capture
[AVFoundation indev @ 0x97ec1c140] [1] Capture screen 0
[AVFoundation indev @ 0x97ec1c140] [2] Capture screen 1
[AVFoundation indev @ 0x97ec1c140] AVFoundation audio devices:
[AVFoundation indev @ 0x97ec1c140] [0] TX USB Audio
[AVFoundation indev @ 0x97ec1c140] [1] USB3.0 HD Audio Capture
[AVFoundation indev @ 0x97ec1c140] [2] RODE NT-USB
`;

test('parseDeviceList splits video and audio', () => {
  const { video, audio } = parseDeviceList(SAMPLE);
  assert.equal(video.length, 3);
  assert.equal(audio.length, 3);
  assert.deepEqual(video[0], { index: 0, name: 'USB3.0 HD Video Capture', kind: 'camera' });
  assert.equal(video[1].kind, 'screen');
  assert.equal(video[2].kind, 'screen');
  assert.deepEqual(audio[2], { index: 2, name: 'RODE NT-USB' });
});

test('parseDeviceList tolerates empty input', () => {
  assert.deepEqual(parseDeviceList(''), { video: [], audio: [] });
});

test('resolveDeviceIndex re-resolves by name', () => {
  const { audio } = parseDeviceList(SAMPLE);
  assert.equal(resolveDeviceIndex(audio, 'RODE NT-USB'), 2);
  assert.equal(resolveDeviceIndex(audio, 'Missing Mic'), null);
});
