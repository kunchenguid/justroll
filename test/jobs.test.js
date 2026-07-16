import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJobs } from '../src/recorder.js';
import { buildJobArgs, buildAudioRecordArgs } from '../src/ffmpegArgs.js';

const SETTINGS = {
  fps: 30,
  codec: 'h264_videotoolbox',
  bitrate: '8M',
  pixelFormat: 'nv12',
  captureCursor: true,
};

test('buildJobs groups all screens into one process, cameras separate', () => {
  const sources = [
    { type: 'screen', label: 'screen-0', videoIndex: 1, outPath: '/r/screen-0.mkv' },
    { type: 'screen', label: 'screen-1', videoIndex: 2, outPath: '/r/screen-1.mkv' },
    { type: 'camera', label: 'camera', videoIndex: 0, outPath: '/r/camera.mkv' },
  ];
  const jobs = buildJobs(sources);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].id, 'screens');
  assert.equal(jobs[0].sources.length, 2);
  assert.equal(jobs[1].id, 'camera');
});

test('buildJobs gives a synthetic (lavfi) source its own job', () => {
  const sources = [
    {
      type: 'screen',
      label: 'screen-0',
      inputFormat: 'lavfi',
      inputSpec: 'testsrc',
      outPath: '/r/s.mkv',
    },
  ];
  const jobs = buildJobs(sources);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].sources[0].inputFormat, 'lavfi');
});

test('buildJobArgs records two screens from one VIDEO-ONLY process into two files', () => {
  const job = {
    id: 'screens',
    sources: [
      { videoIndex: 1, outPath: '/r/screen-0.mkv' },
      { videoIndex: 2, outPath: '/r/screen-1.mkv' },
    ],
  };
  const s = buildJobArgs(job, SETTINGS).join(' ');
  // two screen inputs, no mic input
  assert.equal((s.match(/-f avfoundation/g) || []).length, 2);
  assert.match(s, /-i 1 /);
  assert.match(s, /-i 2 /);
  // never any audio - the mic is recorded by its own process
  assert.ok(!s.includes('-c:a'));
  assert.ok(!s.includes(':a'));
  assert.ok(!s.includes('pipe:3'));
  assert.equal((s.match(/-thread_queue_size 1024/g) || []).length, 2);
  assert.match(s, /-pixel_format nv12/);
  assert.ok(s.includes('/r/screen-0.mkv') && s.includes('/r/screen-1.mkv'));
});

test('buildJobArgs uses a per-source framerate when set (mode-locked cameras)', () => {
  const job = { id: 'camera', sources: [{ videoIndex: 0, outPath: '/r/camera.mkv', fps: 60 }] };
  const s = buildJobArgs(job, SETTINGS).join(' ');
  assert.match(s, /-framerate 60/); // device's supported rate, not the global 30
  assert.ok(!s.includes('-framerate 30'));
});

test('buildJobArgs synthetic job uses -re lavfi and stays video-only', () => {
  const job = {
    id: 's',
    sources: [
      { inputFormat: 'lavfi', inputSpec: 'testsrc=size=640x360:rate=30', outPath: '/r/s.mkv' },
    ],
  };
  const s = buildJobArgs(job, SETTINGS).join(' ');
  assert.match(s, /-re -f lavfi/);
  assert.ok(!s.includes('-c:a'));
});

test('buildAudioRecordArgs captures the mic to its own lossless file', () => {
  const s = buildAudioRecordArgs({ audioIndex: 2, outPath: '/r/audio.wav' }).join(' ');
  assert.match(s, /-f avfoundation -thread_queue_size 1024 -i :2/);
  assert.match(s, /-c:a pcm_s16le -ar 48000/);
  assert.match(s, /-progress pipe:1/);
  assert.ok(s.endsWith('/r/audio.wav'));
  assert.ok(!s.includes('volume=')); // gain 1 -> no filter
});

test('buildAudioRecordArgs applies the macOS input-volume as a gain filter', () => {
  const s = buildAudioRecordArgs({ audioIndex: 2, outPath: '/r/audio.wav', gain: 0.52 }).join(' ');
  assert.match(s, /-af volume=0\.52/);
});
