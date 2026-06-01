import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const DEFAULT_CONFIG = {
  recordingsDir: '~/Recordings',
  video: {
    fps: 30,
    codec: 'h264_videotoolbox',
    bitrate: '8M',
    container: 'mkv',
    pixelFormat: 'nv12',
  },
  remuxToMp4: true, // default ON; the wizard review screen can flip it per-session
  captureCursor: true,
  defaults: { mic: 'RODE NT-USB', embedMicInEveryFile: true },
  rememberLastSelection: true,
  lastSelection: null,
};

export function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

// Shallow-recursive merge: user values win, nested objects merge one level deep.
export function mergeConfig(base, user) {
  const out = { ...base };
  for (const [k, v] of Object.entries(user || {})) {
    out[k] = isObject(v) && isObject(base[k]) ? { ...base[k], ...v } : v;
  }
  return out;
}

export function configDir() {
  return path.join(os.homedir(), '.config', 'justroll');
}

export function configPath() {
  return path.join(configDir(), 'config.json');
}

export function loadConfig(file = configPath()) {
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    user = {};
  }
  return mergeConfig(DEFAULT_CONFIG, user);
}

export function saveConfig(config, file = configPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
}
