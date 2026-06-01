// Environment + readiness checks surfaced inline in the wizard (no separate command).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expandHome } from './config.js';

export const LOW_DISK_BYTES = 5 * 1e9; // warn under ~5 GB free

export function checkFfmpeg(ffmpegPath = 'ffmpeg') {
  try {
    const r = spawnSync(ffmpegPath, ['-hide_banner', '-version'], { encoding: 'utf8' });
    return r.status === 0 || (typeof r.stdout === 'string' && r.stdout.includes('ffmpeg'));
  } catch {
    return false;
  }
}

// Walk up until we hit a directory that exists (recordingsDir may not exist yet).
export function nearestExistingDir(p) {
  let d = p;
  while (d && !fs.existsSync(d)) {
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return d;
}

export function environmentReport(config) {
  const dir = expandHome(config.recordingsDir);
  const base = nearestExistingDir(dir) || dir;
  let writable = true;
  let freeBytes = null;
  try {
    fs.accessSync(base, fs.constants.W_OK);
  } catch {
    writable = false;
  }
  try {
    const s = fs.statfsSync(base);
    freeBytes = s.bavail * s.bsize;
  } catch {
    /* statfs unavailable; skip disk check */
  }
  return { dir, writable, freeBytes };
}

// Pure: turn a report + live wizard state into a list of { level, text } issues.
export function buildIssues(report, { micSelected } = {}) {
  const issues = [];
  if (report) {
    if (report.writable === false) {
      issues.push({
        level: 'error',
        text: `Can't write to ${report.dir} - pick another folder with --dir`,
      });
    }
    if (report.freeBytes != null && report.freeBytes < LOW_DISK_BYTES) {
      issues.push({
        level: 'warn',
        text: `Low disk: ${(report.freeBytes / 1e9).toFixed(1)} GB free where recordings are saved`,
      });
    }
  }
  if (!micSelected) {
    issues.push({
      level: 'warn',
      text: 'No microphone - clips will have no audio track to sync on',
    });
  }
  return issues;
}
