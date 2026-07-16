import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRecordArgs,
  buildAudioTapArgs,
  buildRemuxArgs,
  buildScreenThumbnailArgs,
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
  assert.match(s, /-c:a pcm_s16le -ar 48000/); // lossless capture, encoder off the hot path
  assert.match(s, /-thread_queue_size 1024/); // buffered input -> no dropped-packet static
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

test('buildScreenThumbnailArgs grabs one rgb24 frame to stdout', () => {
  const args = buildScreenThumbnailArgs({ videoIndex: 1, width: 24, height: 12 });
  const s = args.join(' ');
  assert.match(s, /-f avfoundation/);
  assert.match(s, /-framerate 30/); // avfoundation screens need an input framerate
  assert.match(s, /-i 1/);
  assert.match(s, /-frames:v 1/);
  assert.match(s, /scale=24:12/); // fit into the half-block grid...
  assert.match(s, /force_original_aspect_ratio=decrease/); // ...without distorting
  // a device-supported input format (screens AND capture cards reject yuv420p), before -i
  assert.match(s, /-pixel_format nv12/);
  assert.ok(args.indexOf('-pixel_format') < args.indexOf('-i'));
  assert.match(s, /-pix_fmt rgb24/);
  assert.match(s, /-f rawvideo/);
  assert.ok(args.includes('-an')); // no audio
  assert.equal(args[args.length - 1], 'pipe:1');
  // input options precede -i
  assert.ok(args.indexOf('-framerate') < args.indexOf('-i'));
});

test('buildScreenThumbnailArgs supports a generic (lavfi) input', () => {
  const args = buildScreenThumbnailArgs({
    width: 16,
    height: 8,
    inputFormat: 'lavfi',
    inputSpec: 'testsrc=size=320x180',
  });
  const s = args.join(' ');
  assert.match(s, /-f lavfi -i testsrc=size=320x180/);
  assert.ok(!s.includes('avfoundation'));
  assert.ok(!s.includes('-framerate')); // only forced for avfoundation
  assert.equal(args[args.length - 1], 'pipe:1');
});

test('buildAudioTapArgs streams mono s16le to stdout', () => {
  const args = buildAudioTapArgs({ audioIndex: 2 });
  const s = args.join(' ');
  assert.match(s, /-i :2/);
  assert.match(s, /-ac 1/);
  assert.match(s, /-f s16le/);
  assert.equal(args[args.length - 1], '-');
});

test('buildRemuxArgs copies video and encodes PCM audio to AAC for mp4', () => {
  const args = buildRemuxArgs('/r/a.mkv', '/r/a.mp4');
  const s = args.join(' ');
  assert.match(s, /-i \/r\/a\.mkv/);
  assert.match(s, /-c:v copy/); // video stays lossless
  assert.match(s, /-c:a aac -b:a 192k/); // mp4 can't carry PCM
  assert.equal(args[args.length - 1], '/r/a.mp4');
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
