import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDeviceList,
  resolveDeviceIndex,
  parseVideoModes,
  pickFramerate,
  parseInputVolume,
  parseDefaultInputName,
  resolveMicGain,
} from '../src/devices.js';

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

// Real "Supported modes" output from a capture card that is locked to 1080p60.
const MODES = `
[in#0 @ 0x97ec] Selected framerate (30.000000) is not supported by the device.
[in#0 @ 0x97ec] Supported modes:
[in#0 @ 0x97ec]   1920x1080@[60.000240 60.000240]fps
`;

test('parseVideoModes extracts resolution + fps range', () => {
  const modes = parseVideoModes(MODES);
  assert.equal(modes.length, 1);
  assert.equal(modes[0].width, 1920);
  assert.equal(modes[0].height, 1080);
  assert.ok(Math.round(modes[0].maxFps) === 60);
  assert.deepEqual(parseVideoModes('no modes here'), []);
});

test('pickFramerate honors a supported preference, else falls to the device max', () => {
  const modes = parseVideoModes(MODES); // only 1080p60
  assert.equal(pickFramerate(modes, 30), 60); // 30 unsupported -> device's 60
  assert.equal(pickFramerate(modes, 60), 60); // supported -> keep it
  assert.equal(pickFramerate([], 30), 30); // unknown modes -> leave preference (screens)
  const ranged = [{ minFps: 1, maxFps: 60 }];
  assert.equal(pickFramerate(ranged, 30), 30); // inside the range
});

test('parseInputVolume maps the AppleScript 0-100 value to a 0..1 gain', () => {
  assert.equal(parseInputVolume('52'), 0.52);
  assert.equal(parseInputVolume('100'), 1);
  assert.equal(parseInputVolume('0'), 0);
  assert.equal(parseInputVolume('missing value'), null); // device exposes no control
  assert.equal(parseInputVolume(''), null);
});

const SP_AUDIO = `
    Devices:
        C49RG9x:
          Manufacturer: Samsung
        RODE NT-USB:
          Default Input Device: Yes
          Input Source: Default
        Mac mini Speakers:
          Default Output Device: Yes
`;

test('parseDefaultInputName finds the device flagged as default input', () => {
  assert.equal(parseDefaultInputName(SP_AUDIO), 'RODE NT-USB');
  assert.equal(parseDefaultInputName('no devices'), null);
});

test('resolveMicGain applies the slider only to the default input, override wins', () => {
  const base = { volume: 0.52, defaultName: 'RODE NT-USB' };
  assert.equal(resolveMicGain({ micName: 'RODE NT-USB', ...base, override: null }), 0.52);
  assert.equal(resolveMicGain({ micName: 'Other Mic', ...base, override: null }), 1); // not default
  assert.equal(resolveMicGain({ micName: 'RODE NT-USB', ...base, override: 0.3 }), 0.3);
  assert.equal(
    resolveMicGain({ micName: 'X', volume: null, defaultName: null, override: null }),
    1,
  );
});
