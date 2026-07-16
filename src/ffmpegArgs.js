// Pure builders for the ffmpeg argument vectors we spawn. Kept side-effect free so
// every command we run is unit-testable without touching a device.

// `-thread_queue_size` enlarges ffmpeg's per-input packet queue. The tiny default (8)
// drops avfoundation audio packets whenever the encoder/muxer/disk briefly blocks,
// which is heard as intermittent clicks/static - so we raise it on every live input.
const INPUT_QUEUE = '1024';
// Capture audio losslessly (PCM) and at a pinned video-friendly rate. PCM keeps any
// encoder out of the realtime capture path; the AAC encode happens later, at remux.
const AUDIO_CODEC = 'pcm_s16le';
const AUDIO_RATE = '48000';

// One recording process per source. avfoundation input is "video[:audio]".
// `inputFormat` defaults to avfoundation; a generic format (e.g. 'lavfi' with an
// explicit `inputSpec`) is used by the headless pipeline self-test.
export function buildRecordArgs(opts) {
  const {
    videoIndex,
    audioIndex = null,
    fps = 30,
    codec = 'h264_videotoolbox',
    bitrate = '8M',
    outPath,
    captureCursor = true,
    pixelFormat = 'nv12',
    inputFormat = 'avfoundation',
    inputSpec = null,
  } = opts;

  const args = ['-hide_banner', '-loglevel', 'error'];
  let hasAudio = false;
  if (inputFormat === 'avfoundation') {
    const input = audioIndex == null ? `${videoIndex}` : `${videoIndex}:${audioIndex}`;
    // avfoundation input options must precede -i.
    args.push('-f', 'avfoundation', '-thread_queue_size', INPUT_QUEUE, '-framerate', String(fps));
    // Screens reject yuv420p; request a format the device actually supports.
    if (pixelFormat) args.push('-pixel_format', pixelFormat);
    if (captureCursor) args.push('-capture_cursor', '1');
    args.push('-i', input);
    hasAudio = audioIndex != null;
  } else {
    // generic synthetic input, caller supplies the full spec; -re paces it to realtime
    args.push('-re', '-f', inputFormat, '-i', inputSpec);
  }
  // Hardware H.264 on Apple Silicon keeps capture CPU low.
  args.push('-c:v', codec, '-b:v', bitrate);
  if (hasAudio) args.push('-c:a', AUDIO_CODEC, '-ar', AUDIO_RATE);
  // Machine-readable progress on stdout; stdin stays free for the clean "q" stop.
  args.push('-progress', 'pipe:1');
  args.push('-y', outPath);
  return args;
}

// A tiny, separate process that streams mono PCM to stdout so the TUI can draw a waveform.
// Engine-independent: works no matter how recording itself happens.
export function buildAudioTapArgs({ audioIndex, sampleRate = 8000, channels = 1 }) {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'avfoundation',
    '-thread_queue_size',
    INPUT_QUEUE,
    '-i',
    `:${audioIndex}`,
    '-ac',
    String(channels),
    '-ar',
    String(sampleRate),
    '-f',
    's16le',
    '-',
  ];
}

// Group multiple avfoundation video inputs into a SINGLE ffmpeg process with one mapped
// output per video. macOS hangs when two avfoundation screen-capture *processes* run at
// once, so co-recorded screens must share a process.
//
// VIDEO ONLY - no audio is ever muxed here. The mic is recorded by its own dedicated
// process (buildAudioRecordArgs) so nothing competes with the video encoder or a second
// device's clock; clips are realigned afterward by their captured start timestamps.
// `job.sources` is an ordered list of { videoIndex, outPath, fps?, inputFormat?, inputSpec? }.
export function buildJobArgs(job, settings) {
  const sources = job.sources;
  const args = ['-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1'];
  // inputs
  for (const s of sources) {
    if (s.inputFormat && s.inputFormat !== 'avfoundation') {
      args.push('-re', '-f', s.inputFormat, '-i', s.inputSpec);
    } else {
      // Per-source framerate: cameras/capture cards are mode-locked (e.g. 1080p60) and
      // reject the global fps, so plan.js resolves a supported `s.fps` for them.
      args.push(
        '-f',
        'avfoundation',
        '-thread_queue_size',
        INPUT_QUEUE,
        '-framerate',
        String(s.fps ?? settings.fps),
      );
      if (settings.pixelFormat) args.push('-pixel_format', settings.pixelFormat);
      if (settings.captureCursor) args.push('-capture_cursor', '1');
      args.push('-i', String(s.videoIndex));
    }
  }
  // one mapped video output file per input
  sources.forEach((s, i) => {
    args.push('-map', `${i}:v`, '-c:v', settings.codec, '-b:v', settings.bitrate, '-y', s.outPath);
  });
  return args;
}

// The mic in its own isolated process: nothing but capture -> lossless PCM, so it can't
// drop samples while a video encoder hiccups, and there's no foreign-clock A/V drift.
// `gain` (0..1) applies the macOS input-volume slider that avfoundation capture ignores.
// Progress on stdout lets the recorder timestamp its start for cross-file alignment.
export function buildAudioRecordArgs({ audioIndex, outPath, channels = 1, gain = 1 }) {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'avfoundation',
    '-thread_queue_size',
    INPUT_QUEUE,
    '-i',
    `:${audioIndex}`,
  ];
  if (gain != null && gain !== 1) args.push('-af', `volume=${gain}`);
  args.push(
    '-c:a',
    AUDIO_CODEC,
    '-ar',
    AUDIO_RATE,
    '-ac',
    String(channels),
    '-progress',
    'pipe:1',
    '-y',
    outPath,
  );
  return args;
}

// Grab a single frame from one screen and stream it as a tiny RGB24 raw image to
// stdout, so the wizard can show "which desktop is this" thumbnails. Uses the exact
// avfoundation index we'd record, so it disambiguates even two identical monitors -
// no fragile mapping from capture index to a physical display required.
// `force_original_aspect_ratio=decrease` + pad keeps the frame undistorted inside the
// fixed half-block grid. Grabs MUST be run one at a time (see the screen-capture
// invariant in recorder.js).
export function buildScreenThumbnailArgs(opts) {
  const {
    videoIndex,
    width = 24,
    height = 12,
    fps = 30,
    pixelFormat = 'nv12',
    inputFormat = 'avfoundation',
    inputSpec = null,
  } = opts;

  const args = ['-hide_banner', '-loglevel', 'error'];
  if (inputFormat === 'avfoundation') {
    // Request a format the device supports (screens AND capture cards reject ffmpeg's
    // default yuv420p), before -i like all avfoundation input options.
    args.push('-f', 'avfoundation', '-framerate', String(fps));
    if (pixelFormat) args.push('-pixel_format', pixelFormat);
    args.push('-i', String(videoIndex));
  } else {
    args.push('-f', inputFormat, '-i', inputSpec);
  }
  const vf =
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`;
  args.push('-frames:v', '1', '-vf', vf, '-pix_fmt', 'rgb24', '-an', '-f', 'rawvideo', 'pipe:1');
  return args;
}

// Container swap MKV -> MP4 after recording stops. Video is copied losslessly; the PCM
// capture audio is encoded to AAC here (MP4 can't carry PCM, and this is off the realtime
// path). A video-only file simply has no audio stream to encode.
export function buildRemuxArgs(inPath, outPath) {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inPath,
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-y',
    outPath,
  ];
}

// Parse a chunk of `-progress pipe:1` output (key=value lines) into the latest values.
export function parseProgress(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

// Normalize raw progress strings into typed stats for the dashboard.
export function normalizeProgress(p) {
  const num = (v) => (v == null || v === 'N/A' ? null : Number(v));
  const us = num(p.out_time_us ?? p.out_time_ms);
  return {
    frame: num(p.frame),
    fps: num(p.fps),
    bytes: num(p.total_size),
    drop: num(p.drop_frames),
    dup: num(p.dup_frames),
    speed: p.speed ?? null,
    seconds: us == null ? null : us / 1_000_000,
    done: p.progress === 'end',
  };
}
