import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRecordArgs,
  buildAudioTapArgs,
  buildRemuxArgs,
  parseProgress,
  normalizeProgress,
} from '../src/ffmpegArgs.js';

test('buildRecordArgs maps a screen + mic to a valid command', () => {
  const args = buildRecordArgs({
    videoIndex: 1,
    audioIndex: 2,
    fps: 30,
    outPath: '/r/screen-0.mkv',
  });
  const s = args.join(' ');
  assert.match(s, /-f avfoundation/);
  assert.match(s, /-framerate 30/);
  assert.match(s, /-i 1:2/);
  assert.match(s, /-c:v h264_videotoolbox/);
  assert.match(s, /-c:a aac/);
  assert.match(s, /-progress pipe:1/);
  // screens reject yuv420p, so we request nv12 explicitly, before -i
  assert.match(s, /-pixel_format nv12/);
  assert.ok(args.indexOf('-pixel_format') < args.indexOf('-i'));
  assert.equal(args[args.length - 1], '/r/screen-0.mkv');
  // input options precede -i
  assert.ok(args.indexOf('-framerate') < args.indexOf('-i'));
});

test('buildRecordArgs omits audio when no mic', () => {
  const args = buildRecordArgs({ videoIndex: 1, audioIndex: null, outPath: '/r/x.mkv' });
  assert.match(args.join(' '), /-i 1(?!:)/);
  assert.ok(!args.includes('-c:a'));
});

test('buildRecordArgs supports a generic (lavfi) input for the self-test', () => {
  const args = buildRecordArgs({
    inputFormat: 'lavfi',
    inputSpec: 'testsrc=size=640x360:rate=30',
    outPath: '/r/synthetic.mkv',
  });
  const s = args.join(' ');
  assert.match(s, /-re -f lavfi -i testsrc=size=640x360:rate=30/);
  assert.ok(!s.includes('avfoundation'));
  assert.ok(!s.includes('-pixel_format')); // only forced for avfoundation
  assert.ok(!args.includes('-c:a')); // no avfoundation audio muxed
  assert.equal(args[args.length - 1], '/r/synthetic.mkv');
});

test('buildAudioTapArgs streams mono s16le to stdout', () => {
  const args = buildAudioTapArgs({ audioIndex: 2 });
  const s = args.join(' ');
  assert.match(s, /-i :2/);
  assert.match(s, /-ac 1/);
  assert.match(s, /-f s16le/);
  assert.equal(args[args.length - 1], '-');
});

test('buildRemuxArgs copies streams', () => {
  const args = buildRemuxArgs('/r/a.mkv', '/r/a.mp4');
  assert.deepEqual(args.slice(-6), ['-i', '/r/a.mkv', '-c', 'copy', '-y', '/r/a.mp4']);
});

test('parseProgress + normalizeProgress yield typed stats', () => {
  const raw = parseProgress(
    'frame=88\nfps=29.00\ntotal_size=2118000\nout_time_us=2960000\ndrop_frames=0\nspeed=0.98x\nprogress=continuing\n',
  );
  const n = normalizeProgress(raw);
  assert.equal(n.frame, 88);
  assert.equal(n.fps, 29);
  assert.equal(n.bytes, 2118000);
  assert.equal(n.drop, 0);
  assert.equal(n.seconds, 2.96);
  assert.equal(n.done, false);
});

test('normalizeProgress flags end and N/A', () => {
  const n = normalizeProgress({ frame: 'N/A', progress: 'end' });
  assert.equal(n.frame, null);
  assert.equal(n.done, true);
});
