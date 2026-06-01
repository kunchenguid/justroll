#!/usr/bin/env node
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from '../src/config.js';
import { enumerateDevices } from '../src/devices.js';
import { buildPlan, ensurePlanDirs } from '../src/plan.js';
import { buildNotesMarkdown, buildSessionManifest } from '../src/session.js';
import { FfmpegEngine } from '../src/recorder.js';
import { checkFfmpeg, environmentReport } from '../src/health.js';
import { initDefaultTelemetry } from '../src/telemetry.js';

const PKG = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function parseArgs(argv) {
  const out = {
    title: null,
    selftest: false,
    demo: false,
    help: false,
    version: false,
    dir: null,
    noMp4: false,
    fps: null,
    seconds: 2,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--selftest') out.selftest = true;
    else if (a === '--demo') out.demo = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--version' || a === '-v') out.version = true;
    else if (a === '--no-mp4') out.noMp4 = true;
    else if (a === '--dir') out.dir = argv[++i];
    else if (a === '--fps') out.fps = Number(argv[++i]);
    else if (a === '--seconds') out.seconds = Number(argv[++i]);
    else if (!a.startsWith('-') && out.title == null) out.title = a;
  }
  return out;
}

const HELP = `
  justroll - one-command multi-source screen + camera recorder

  Usage
    justroll "video title"        start the recording wizard
    justroll --selftest           headless 2s capture to verify the pipeline
    justroll --help

  Options
    --dir <path>    override recordings directory
    --no-mp4        keep MKV only (skip the mp4 remux)
    --fps <n>       capture frame rate (default from config)
    --version

  Every screen and camera records to its own file, all carrying the same mic
  track so any editor's sync-by-audio lines them up. Ctrl+C stops cleanly.
`;

function applyOverrides(config, args) {
  const c = structuredClone(config);
  if (args.dir) c.recordingsDir = args.dir;
  if (args.noMp4) c.remuxToMp4 = false;
  if (args.fps) c.video.fps = args.fps;
  return c;
}

async function selftest(config, args) {
  const devices = enumerateDevices();
  const screens = devices.video.filter((d) => d.kind === 'screen');
  const mic =
    devices.audio.find((a) => a.name === config.defaults?.mic) || devices.audio[0] || null;
  const baseDir = path.join(os.tmpdir(), 'justroll-selftest');
  fs.rmSync(baseDir, { recursive: true, force: true });
  const cfg = { ...applyOverrides(config, args), recordingsDir: baseDir };

  let selectedSources;
  let mode;
  if (screens.length > 0) {
    selectedSources = screens
      .slice(0, 2)
      .map((d) => ({ type: 'screen', deviceIndex: d.index, deviceName: d.name }));
    mode = `real avfoundation: ${selectedSources.map((s) => s.deviceName).join(', ')}`;
  } else {
    // No screens exposed (display asleep/locked or Screen Recording permission off).
    // Still exercise the full orchestration with a synthetic source.
    selectedSources = [
      {
        type: 'screen',
        deviceIndex: 0,
        deviceName: 'synthetic testsrc',
        inputFormat: 'lavfi',
        inputSpec: `testsrc=size=1280x720:rate=${cfg.video.fps}`,
      },
    ];
    mode = 'synthetic lavfi (no screens available - pipeline-only validation)';
  }
  console.log(`mode: ${mode}`);
  console.log(`mic:  ${mic ? mic.name : 'none'}`);
  const plan = buildPlan({
    title: 'selftest',
    selectedSources,
    mic,
    config: cfg,
    date: new Date(),
  });
  ensurePlanDirs(plan);
  fs.writeFileSync(path.join(plan.dir, 'notes.md'), buildNotesMarkdown(plan));

  console.log(`recording ${plan.sources.length} source(s) for ${args.seconds}s -> ${plan.dir}`);
  const rec = new FfmpegEngine().createRecording(plan);
  let levels = 0;
  const exitInfo = new Map();
  rec.on('level', () => {
    levels++;
  });
  rec.on('source-error', ({ label, error }) =>
    console.error(`  source ${label}: ${error.message.split('\n')[0]}`),
  );
  rec.on('source-exit', ({ label, code, signal, stderr }) =>
    exitInfo.set(label, { code, signal, stderr }),
  );
  rec.start();
  await new Promise((r) => setTimeout(r, args.seconds * 1000));
  const results = await rec.stop();
  const manifest = buildSessionManifest(plan, {
    startedAt: rec.startedAt,
    endedAt: rec.endedAt,
    results: results.map((r) => ({
      label: r.label,
      bytes: r.bytes,
      seconds: r.seconds,
      mp4: r.mp4,
    })),
  });
  fs.writeFileSync(path.join(plan.dir, 'session.json'), JSON.stringify(manifest, null, 2) + '\n');

  let ok = true;
  for (const r of results) {
    const exists = fs.existsSync(r.file) && fs.statSync(r.file).size > 0;
    const mp4ok = !r.mp4 || (fs.existsSync(r.mp4) && fs.statSync(r.mp4).size > 0);
    if (!exists || !mp4ok) ok = false;
    console.log(
      `  ${exists && mp4ok ? 'OK ' : 'BAD'} ${path.basename(r.file)}  ${(r.bytes / 1e6).toFixed(1)} MB  ${r.seconds ?? '?'}s${r.mp4 ? '  +mp4' : ''}`,
    );
    if (!(exists && mp4ok)) {
      const info = exitInfo.get(r.label) || {};
      const tail = (info.stderr || '')
        .split('\n')
        .filter((l) => l && !/NSKVONotifying/.test(l))
        .slice(-3)
        .join(' | ');
      console.log(
        `      exit code=${info.code} signal=${info.signal}${tail ? `  stderr: ${tail}` : '  (no stderr - process produced no frames before stop)'}`,
      );
    }
  }
  console.log(`  audio frames captured: ${levels}`);
  console.log(ok ? 'SELFTEST PASS' : 'SELFTEST FAIL');
  process.exit(ok ? 0 : 1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  if (args.version) {
    console.log(PKG.version);
    return;
  }

  const config = loadConfig();

  if (!checkFfmpeg()) {
    process.stderr.write(
      'error: ffmpeg not found on your PATH.\n  Install it with:  brew install ffmpeg\n',
    );
    process.exit(1);
  }

  if (args.selftest) return selftest(config, args);

  if (!process.stdout.isTTY) {
    process.stderr.write(
      'justroll needs an interactive terminal. Try --selftest for a headless check.\n',
    );
    process.exit(1);
  }

  const { render } = await import('ink');
  const { html } = await import('../src/ui/h.js');
  const { default: App } = await import('../src/ui/App.js');

  let devices;
  let engine = null;
  let cfg = applyOverrides(config, args);
  const title = args.title || 'Untitled';

  if (args.demo) {
    // Live preview with a synthetic engine + representative devices; nothing is recorded for real.
    const { MockEngine } = await import('../src/ui/mockEngine.js');
    const { MOCK_DEVICES } = await import('../src/ui/mockDevices.js');
    devices = MOCK_DEVICES;
    engine = new MockEngine();
    cfg = { ...cfg, recordingsDir: path.join(os.tmpdir(), 'justroll-demo') };
  } else {
    if (!args.title) {
      process.stderr.write('error: a video title is required\n' + HELP);
      process.exit(1);
    }
    devices = enumerateDevices();
  }

  const health = environmentReport(cfg);

  // Anonymous usage telemetry (counts only, no titles/paths). Skipped for --demo.
  // Opt out with JUSTROLL_TELEMETRY=0.
  let telemetry = null;
  if (!args.demo) {
    telemetry = initDefaultTelemetry({
      app: 'justroll',
      version: PKG.version,
      platform: process.platform,
      arch: process.arch,
    });
    telemetry.pageview('/wizard');
  }

  const app = render(
    html`<${App}
      title=${title}
      devices=${devices}
      config=${cfg}
      engine=${engine}
      health=${health}
      telemetry=${telemetry}
    />`,
    { exitOnCtrlC: false },
  );
  await app.waitUntilExit();
  if (telemetry) await telemetry.close(1000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
