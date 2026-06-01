// Turn the wizard's selections into a fully-resolved recording plan: every path,
// every ffmpeg input index, every output file decided up front.
import path from 'node:path';
import fs from 'node:fs';
import { expandHome } from './config.js';
import { sessionDirName, uniqueDirName, assignLabels, fileName } from './naming.js';

export function buildPlan({
  title,
  selectedSources, // [{ type:'screen'|'camera', deviceIndex, deviceName }]
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
  const embedMic = config.defaults?.embedMicInEveryFile !== false && mic != null;

  const labeled = assignLabels(selectedSources);
  const sources = labeled.map((s) => {
    const fn = fileName(s.label, container);
    return {
      ...s,
      fileName: fn,
      outPath: path.join(rawDir, fn),
      videoIndex: s.deviceIndex,
      audioIndex: embedMic ? mic.index : null,
    };
  });

  return {
    title,
    dirName,
    dir,
    rawDir,
    exportsDir: path.join(dir, 'exports'),
    projectDir: path.join(dir, 'project'),
    mic: embedMic ? mic : null,
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
