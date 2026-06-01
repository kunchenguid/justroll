// Pure builders for the ffmpeg argument vectors we spawn. Kept side-effect free so
// every command we run is unit-testable without touching a device.

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
    args.push('-f', 'avfoundation', '-framerate', String(fps));
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
  if (hasAudio) args.push('-c:a', 'aac', '-b:a', '192k');
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

// Group multiple avfoundation video inputs + one shared mic into a SINGLE ffmpeg
// process with one mapped output per video. macOS hangs when two avfoundation
// screen-capture *processes* run at once, so co-recorded screens must share a process.
// `job.sources` is an ordered list of { videoIndex, outPath, inputFormat?, inputSpec? }.
export function buildJobArgs(job, settings, mic) {
  const sources = job.sources;
  const synthetic = sources.some((s) => s.inputFormat && s.inputFormat !== 'avfoundation');
  const useMic = mic != null && !synthetic;
  const micInput = sources.length; // mic is the input after all video inputs

  const args = ['-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1'];
  // inputs
  for (const s of sources) {
    if (s.inputFormat && s.inputFormat !== 'avfoundation') {
      args.push('-re', '-f', s.inputFormat, '-i', s.inputSpec);
    } else {
      args.push('-f', 'avfoundation', '-framerate', String(settings.fps));
      if (settings.pixelFormat) args.push('-pixel_format', settings.pixelFormat);
      if (settings.captureCursor) args.push('-capture_cursor', '1');
      args.push('-i', String(s.videoIndex));
    }
  }
  if (useMic) args.push('-f', 'avfoundation', '-i', `:${mic.index}`);
  // one mapped output file per video input, each muxing the shared mic
  sources.forEach((s, i) => {
    args.push('-map', `${i}:v`);
    if (useMic) args.push('-map', `${micInput}:a`);
    args.push('-c:v', settings.codec, '-b:v', settings.bitrate);
    if (useMic) args.push('-c:a', 'aac', '-b:a', '192k');
    args.push('-y', s.outPath);
  });
  return args;
}

// Fast, lossless container swap MKV -> MP4 after recording stops.
export function buildRemuxArgs(inPath, outPath) {
  return ['-hide_banner', '-loglevel', 'error', '-i', inPath, '-c', 'copy', '-y', outPath];
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
