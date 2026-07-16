// Enumerate macOS avfoundation capture devices via ffmpeg and parse the listing.
import { spawnSync } from 'node:child_process';

const SCREEN_RE = /capture screen/i;

// Parse the stderr text emitted by:
//   ffmpeg -f avfoundation -list_devices true -i ""
// into { video: [{ index, name, kind }], audio: [{ index, name }] }.
export function parseDeviceList(text) {
  const video = [];
  const audio = [];
  let bucket = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/^\[[^\]]*\]\s*/, ''); // strip "[AVFoundation indev @ 0x..] "
    if (/AVFoundation video devices:/i.test(line)) {
      bucket = 'video';
      continue;
    }
    if (/AVFoundation audio devices:/i.test(line)) {
      bucket = 'audio';
      continue;
    }
    const m = line.match(/^\s*\[(\d+)\]\s+(.*\S)\s*$/);
    if (!m || !bucket) continue;
    const index = Number(m[1]);
    const name = m[2];
    if (bucket === 'video') {
      video.push({ index, name, kind: SCREEN_RE.test(name) ? 'screen' : 'camera' });
    } else {
      audio.push({ index, name });
    }
  }
  return { video, audio };
}

// Match a remembered device by name to its current index (indexes drift on replug).
export function resolveDeviceIndex(list, name) {
  const hit = list.find((d) => d.name === name);
  return hit ? hit.index : null;
}

export function enumerateDevices(ffmpegPath = 'ffmpeg') {
  const res = spawnSync(
    ffmpegPath,
    ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''],
    { encoding: 'utf8' },
  );
  // ffmpeg prints the listing to stderr and exits non-zero by design.
  const text = `${res.stderr || ''}${res.stdout || ''}`;
  return parseDeviceList(text);
}

// Cameras and capture cards are mode-locked (e.g. a card that only does 1080p60), so a
// forced framerate they don't support fails with "Selected framerate is not supported".
// ffmpeg lists the supported modes in that error, so we parse them out of lines like:
//   1920x1080@[60.000240 60.000240]fps
export function parseVideoModes(text) {
  const modes = [];
  const re = /(\d+)x(\d+)@\[([\d.]+)\s+([\d.]+)\]fps/g;
  let m;
  for (const line of String(text).split(/\r?\n/)) {
    re.lastIndex = 0;
    while ((m = re.exec(line))) {
      modes.push({
        width: Number(m[1]),
        height: Number(m[2]),
        minFps: Number(m[3]),
        maxFps: Number(m[4]),
      });
    }
  }
  return modes;
}

// Provoke the "Supported modes" listing by requesting a framerate no camera supports
// (1 fps), then parse it. Returns [] if the device can't be opened at all (unavailable).
// Only safe for capture devices - a screen might actually start a 1 fps capture.
export function probeVideoModes(index, ffmpegPath = 'ffmpeg') {
  const res = spawnSync(
    ffmpegPath,
    ['-hide_banner', '-f', 'avfoundation', '-framerate', '1', '-i', String(index)],
    { encoding: 'utf8', timeout: 4000 },
  );
  return parseVideoModes(`${res.stderr || ''}${res.stdout || ''}`);
}

// Choose a framerate the device actually supports: the preferred one if it falls inside a
// supported mode's range, otherwise the device's highest available rate.
export function pickFramerate(modes, preferred) {
  if (!modes || !modes.length) return preferred;
  const supported = (f) => modes.some((m) => f >= Math.floor(m.minFps) && f <= Math.ceil(m.maxFps));
  if (supported(preferred)) return preferred;
  return Math.round(Math.max(...modes.map((m) => m.maxFps)));
}

// macOS "Input volume" (Sound settings) is a 0-100 software gain on the DEFAULT input
// that ffmpeg's avfoundation capture does NOT apply, so we read it and apply it ourselves
// as a `volume` filter. Returns a 0..1 scalar, or null if the device exposes no control.
export function parseInputVolume(text) {
  const trimmed = String(text).trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n / 100)) : null;
}

export function macInputVolume(run) {
  const exec = run || ((cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' }));
  try {
    const r = exec('osascript', ['-e', 'input volume of (get volume settings)']);
    return parseInputVolume(`${r.stdout || ''}`);
  } catch {
    return null;
  }
}

// The macOS input-volume slider only controls the *default* input device, so we apply it
// only when the selected mic is that device. Parse the name out of `system_profiler`.
export function parseDefaultInputName(text) {
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const header = raw.match(/^\s+([^:]+):\s*$/); // "        RODE NT-USB:"
    if (header) {
      current = header[1].trim();
      continue;
    }
    if (/Default Input Device:\s*Yes/i.test(raw)) return current;
  }
  return null;
}

export function defaultInputName(run) {
  const exec = run || ((cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' }));
  try {
    const r = exec('system_profiler', ['SPAudioDataType']);
    return parseDefaultInputName(`${r.stdout || ''}`);
  } catch {
    return null;
  }
}

// The gain to apply to the recorded mic: the macOS input volume when the selected mic is
// the default input, else 1 (full). `override` (config.audioGain) wins when set.
export function resolveMicGain({ micName, override, volume, defaultName }) {
  if (override != null) return Math.max(0, override);
  if (volume == null || defaultName == null || micName !== defaultName) return 1;
  return volume;
}
