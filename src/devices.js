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
