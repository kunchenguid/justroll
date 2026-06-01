import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJobs } from '../src/recorder.js';
import { buildJobArgs } from '../src/ffmpegArgs.js';

const SETTINGS = {
  fps: 30,
  codec: 'h264_videotoolbox',
  bitrate: '8M',
  pixelFormat: 'nv12',
  captureCursor: true,
};
const MIC = { index: 2, name: 'RODE NT-USB' };

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

test('buildJobArgs records two screens + mic from one process into two files', () => {
  const job = {
    id: 'screens',
    sources: [
      { videoIndex: 1, outPath: '/r/screen-0.mkv' },
      { videoIndex: 2, outPath: '/r/screen-1.mkv' },
    ],
  };
  const args = buildJobArgs(job, SETTINGS, MIC);
  const s = args.join(' ');
  // two screen inputs + one mic input
  assert.equal((s.match(/-f avfoundation/g) || []).length, 3);
  assert.match(s, /-i 1 /);
  assert.match(s, /-i 2 /);
  assert.match(s, /-i :2/);
  // two outputs, mic mapped into both
  assert.equal((s.match(/-map 2:a/g) || []).length, 2);
  assert.match(s, /-pixel_format nv12/);
  assert.ok(s.includes('/r/screen-0.mkv') && s.includes('/r/screen-1.mkv'));
});

test('buildJobArgs synthetic job has no mic and uses -re lavfi', () => {
  const job = {
    id: 's',
    sources: [
      { inputFormat: 'lavfi', inputSpec: 'testsrc=size=640x360:rate=30', outPath: '/r/s.mkv' },
    ],
  };
  const args = buildJobArgs(job, SETTINGS, MIC);
  const s = args.join(' ');
  assert.match(s, /-re -f lavfi/);
  assert.ok(!s.includes(':2')); // no mic
  assert.ok(!s.includes('-c:a'));
});
