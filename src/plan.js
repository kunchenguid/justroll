// Turn the wizard's selections into a fully-resolved recording plan: every path,
// every ffmpeg input index, every output file decided up front.
import path from 'node:path';
import fs from 'node:fs';
import { expandHome } from './config.js';
import { sessionDirName, uniqueDirName, assignLabels, fileName } from './naming.js';

const AUDIO_FILE = 'audio.wav';

export function buildPlan({
  title,
  selectedSources, // [{ type:'screen'|'camera', deviceIndex, deviceName, fps? }]
  mic, // { index, name } | null
  config,
  date = new Date(),
  existsFn,
}) {
  const baseDir = expandHome(config.recordingsDir);
  const exists = existsFn || ((name) => fs.existsSync(path.join(baseDir, name)));
  const dirName = uniqueDirName(sessionDirName(title, date), exists);
  const dir = path.join(baseDir, dirName);
  const rawDir = path.join(dir, 'raw');
  const container = config.video.container || 'mkv';
  const recordMic = config.defaults?.embedMicInEveryFile !== false && mic != null;

  const labeled = assignLabels(selectedSources);
  // Every clip is video-only; the mic gets its own isolated file (below). Clips realign
  // afterward by their captured start timestamps, not by muxed audio.
  const sources = labeled.map((s) => {
    const fn = fileName(s.label, container);
    return {
      ...s,
      fileName: fn,
      outPath: path.join(rawDir, fn),
      videoIndex: s.deviceIndex,
      fps: s.fps, // per-source rate (cameras run at a supported mode); undefined -> global
    };
  });

  return {
    title,
    dirName,
    dir,
    rawDir,
    exportsDir: path.join(dir, 'exports'),
    projectDir: path.join(dir, 'project'),
    mic: recordMic ? mic : null,
    // The dedicated, isolated audio capture (PCM WAV) - or null when there's no mic.
    // `gain` (0..1) is the macOS input-volume the caller resolved; defaults to full.
    audio: recordMic
      ? {
          index: mic.index,
          fileName: AUDIO_FILE,
          outPath: path.join(rawDir, AUDIO_FILE),
          gain: mic.gain ?? 1,
        }
      : null,
    settings: {
      fps: config.video.fps,
      codec: config.video.codec,
      bitrate: config.video.bitrate,
      container,
      pixelFormat: config.video.pixelFormat || 'nv12',
      captureCursor: config.captureCursor !== false,
      remuxToMp4: config.remuxToMp4 !== false,
    },
    sources,
  };
}

export function ensurePlanDirs(plan) {
  for (const d of [plan.dir, plan.rawDir, plan.exportsDir, plan.projectDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
