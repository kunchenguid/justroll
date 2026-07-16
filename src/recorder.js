// The FfmpegEngine: spawns each capture as its own clean process, parses live progress,
// and tears everything down cleanly on stop.
//
// macOS will hang if two avfoundation screen-capture processes run at once, so all
// screens are recorded by ONE video-only ffmpeg process with one mapped output per
// screen. Each camera (and each synthetic self-test source) gets its own process.
//
// Audio is NEVER muxed into video. The mic records in its OWN isolated process (clean
// PCM, nothing competing -> no dropouts, no foreign-clock A/V drift), and the live
// waveform comes from a separate, decoupled meter tap whose back-pressure can never
// stall a recording. Because every process gets `q` at the same instant, content ends
// are synchronized, so on stop we end-align by actual ffprobe duration (`maxDur - dur`)
// into per-file `startOffsetMs`, and pad the mic's warmup-shortened front with silence so
// audio.wav drops in at 0 - no reliance on muxed audio content for sync.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import {
  buildJobArgs,
  buildAudioRecordArgs,
  buildAudioTapArgs,
  buildRemuxArgs,
  buildScreenThumbnailArgs,
  parseProgress,
  normalizeProgress,
} from './ffmpegArgs.js';
import { rmsFromS16LE, peakFromS16LE, levelToUnit } from './audioMeter.js';
import { renderRgbHalfBlocks } from './thumbnail.js';

const BYTES_PER_SAMPLE = 2;
const TAP_SAMPLE_RATE = 8000;
const FRAME_SAMPLES = 256; // ~32ms windows -> smooth waveform
const FRAME_BYTES = FRAME_SAMPLES * BYTES_PER_SAMPLE;

// Read mono PCM frames off a tap's stdout and emit a level per ~32ms window.
function pipeLevels(stdout, onLevel) {
  let leftover = Buffer.alloc(0);
  stdout.on('data', (chunk) => {
    let buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
    let off = 0;
    while (buf.length - off >= FRAME_BYTES) {
      const frame = buf.subarray(off, off + FRAME_BYTES);
      off += FRAME_BYTES;
      const rms = rmsFromS16LE(frame);
      onLevel({ unit: levelToUnit(rms), rms, peak: peakFromS16LE(frame) });
    }
    leftover = buf.subarray(off);
  });
}

function spawnMicTap(ffmpegPath, audioIndex, onLevel) {
  const tap = spawn(ffmpegPath, buildAudioTapArgs({ audioIndex, sampleRate: TAP_SAMPLE_RATE }), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pipeLevels(tap.stdout, onLevel);
  tap.on('error', () => {}); // metering is non-critical
  return tap;
}

// Public helper so the wizard can show a live mic meter before recording starts.
// Returns a stop() function.
export function startMicTap({ ffmpegPath = 'ffmpeg', audioIndex, onLevel = () => {} }) {
  const tap = spawnMicTap(ffmpegPath, audioIndex, onLevel);
  return () => {
    try {
      tap.kill('SIGKILL');
    } catch {}
  };
}

// Grab one frame from a screen and return it as half-block thumbnail lines for the
// wizard. Resolves null on any failure (permission off, no frames, ffmpeg missing) so
// callers just fall back to a text label. Callers MUST invoke this sequentially - two
// concurrent avfoundation screen captures deadlock macOS (the core invariant above).
export function grabScreenThumbnail({
  ffmpegPath = 'ffmpeg',
  videoIndex,
  width = 24,
  height = 12,
  fps = 30,
  inputFormat = 'avfoundation',
  inputSpec = null,
  timeoutMs = 4000,
} = {}) {
  const args = buildScreenThumbnailArgs({ videoIndex, width, height, fps, inputFormat, inputSpec });
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return resolve(null);
    }
    const chunks = [];
    child.stdout.on('data', (d) => chunks.push(d));
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
    }, timeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('exit', () => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      const need = width * height * 3;
      if (buf.length < need) return resolve(null);
      // Keep the last full frame in case ffmpeg emitted a stray partial one.
      const rgb = buf.subarray(buf.length - need);
      resolve({ width, height, lines: renderRgbHalfBlocks(rgb, width, height) });
    });
  });
}

export function buildJobs(sources) {
  const isAv = (s) => !s.inputFormat || s.inputFormat === 'avfoundation';
  const screens = sources.filter((s) => s.type === 'screen' && isAv(s));
  const rest = sources.filter((s) => !(s.type === 'screen' && isAv(s)));
  const jobs = [];
  if (screens.length) jobs.push({ id: 'screens', sources: screens });
  for (const s of rest) jobs.push({ id: s.label, sources: [s] });
  return jobs;
}

export class Recorder extends EventEmitter {
  constructor(plan, { ffmpegPath = 'ffmpeg' } = {}) {
    super();
    this.plan = plan;
    this.ffmpegPath = ffmpegPath;
    this.jobs = buildJobs(plan.sources);
    this.procs = new Map(); // jobId -> child
    this.jobProgress = new Map(); // jobId -> normalized stats
    this.jobOf = new Map(); // label -> jobId
    this.stderr = new Map(); // jobId -> string
    this.stats = new Map(); // label -> { bytes, fps, drop, seconds }
    this.tap = null;
    this.statTimer = null;
    this.startedAt = null;
    this.endedAt = null;
    this.stopping = false;
    for (const job of this.jobs) for (const s of job.sources) this.jobOf.set(s.label, job.id);
  }

  start() {
    this.startedAt = new Date().toISOString();
    // Open the mic FIRST so its (slow-warming) avfoundation device isn't queued behind a
    // capture card opening - this shrinks how much audio start it loses. Its own isolated
    // process keeps clean PCM; a decoupled meter tap drives the live waveform.
    if (this.plan.audio) {
      const child = spawn(
        this.ffmpegPath,
        buildAudioRecordArgs({
          audioIndex: this.plan.audio.index,
          outPath: this.plan.audio.outPath,
          gain: this.plan.audio.gain,
        }),
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      this._wireProgress('audio', child);
      child.on('error', (err) => this.emit('source-error', { label: 'audio', error: err }));
      child.on('exit', (code, signal) => {
        const stderr = this.stderr.get('audio');
        this.emit('source-exit', { label: 'audio', code, signal, stderr });
        if (!this.stopping && code !== 0 && signal == null) {
          this.emit('source-error', {
            label: 'audio',
            error: new Error((stderr || '').trim() || `audio exited with code ${code}`),
          });
        }
      });
      this.procs.set('audio', child);
      this._startTap();
    }
    // Video-only capture jobs.
    for (const job of this.jobs) {
      const child = spawn(this.ffmpegPath, buildJobArgs(job, this.plan.settings), {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this._wireProgress(job.id, child);
      child.on('error', (err) => this._failJob(job, err));
      child.on('exit', (code, signal) => {
        const stderr = this.stderr.get(job.id);
        for (const s of job.sources)
          this.emit('source-exit', { label: s.label, code, signal, stderr });
        if (!this.stopping && code !== 0 && signal == null) {
          this._failJob(
            job,
            new Error((stderr || '').trim() || `${job.id} exited with code ${code}`),
          );
        }
      });
      this.procs.set(job.id, child);
    }
    this._startStatPoll();
    this.emit('start', { startedAt: this.startedAt });
    return this;
  }

  // Wire a capture process's `-progress` stdout into the live stats map.
  _wireProgress(id, child) {
    this.stderr.set(id, '');
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      this.jobProgress.set(id, {
        ...(this.jobProgress.get(id) || {}),
        ...normalizeProgress(parseProgress(chunk)),
      });
    });
    child.stderr.on('data', (d) => this.stderr.set(id, this.stderr.get(id) + d));
  }

  _startTap() {
    if (this.plan.mic == null) return;
    this.tap = spawnMicTap(this.ffmpegPath, this.plan.mic.index, (lvl) => this.emit('level', lvl));
  }

  _failJob(job, error) {
    for (const s of job.sources) this.emit('source-error', { label: s.label, error });
  }

  // Per-file byte sizes come from the filesystem (a grouped process reports only
  // aggregate progress), while fps/drop come from that job's progress stream.
  _startStatPoll() {
    const sample = (label, id, outPath) => {
      const jp = this.jobProgress.get(id) || {};
      let bytes = null;
      try {
        bytes = fs.statSync(outPath).size;
      } catch {}
      const stats = {
        bytes,
        fps: jp.fps ?? null,
        drop: jp.drop ?? null,
        seconds: jp.seconds ?? null,
      };
      this.stats.set(label, stats);
      this.emit('stats', { label, stats });
    };
    const poll = () => {
      for (const s of this.plan.sources) sample(s.label, this.jobOf.get(s.label), s.outPath);
      if (this.plan.audio) sample('audio', 'audio', this.plan.audio.outPath);
    };
    this.statTimer = setInterval(poll, 400);
  }

  async stop({ graceMs = 4000 } = {}) {
    if (this.stopping) return this._results;
    this.stopping = true;
    this.emit('stopping');
    if (this.statTimer) clearInterval(this.statTimer);

    const waits = [];
    for (const [, child] of this.procs) {
      waits.push(
        new Promise((resolve) => {
          if (child.exitCode != null || child.signalCode != null) return resolve();
          child.once('exit', () => resolve());
          try {
            child.stdin.write('q');
            child.stdin.end();
          } catch {
            /* fall through to signals */
          }
          setTimeout(() => {
            if (child.exitCode == null && child.signalCode == null) {
              try {
                child.kill('SIGINT');
              } catch {}
              setTimeout(() => {
                if (child.exitCode == null && child.signalCode == null) {
                  try {
                    child.kill('SIGKILL');
                  } catch {}
                }
              }, 1500);
            }
          }, graceMs);
        }),
      );
    }
    await Promise.all(waits);
    if (this.tap) {
      try {
        this.tap.kill('SIGKILL');
      } catch {}
    }

    if (this.plan.settings.remuxToMp4) {
      for (const s of this.plan.sources) await this._remux(s); // video only; audio.wav is final
    }

    // All processes got `q` together, so their content ENDS at the same instant; a shorter
    // file simply started later (device warmup). End-align by actual duration: the longest
    // file is the reference (offset 0), everyone else begins `maxDur - dur` ms later.
    const durs = new Map();
    for (const s of this.plan.sources) durs.set(s.label, await this._probeDurationSec(s.outPath));
    if (this.plan.audio) durs.set('audio', await this._probeDurationSec(this.plan.audio.outPath));
    const known = [...durs.values()].filter((d) => d != null);
    const maxDur = known.length ? Math.max(...known) : null;
    const offsetMs = (label) => {
      const d = durs.get(label);
      return maxDur != null && d != null ? Math.round((maxDur - d) * 1000) : null;
    };

    // Pad the mic's warmup-delayed front with silence so audio.wav drops in at 0, aligned
    // with the video. (The lost warmup window becomes leading silence, not a desync.)
    let audioPaddedMs = 0;
    if (this.plan.audio) {
      const off = offsetMs('audio');
      if (off != null && off > 20 && (await this._padAudioFront(this.plan.audio.outPath, off))) {
        audioPaddedMs = off;
        durs.set('audio', maxDur); // now full-length and aligned at 0
      }
    }

    this.endedAt = new Date().toISOString();

    const sizeOf = (outPath) => {
      try {
        return fs.statSync(outPath).size;
      } catch {
        return null;
      }
    };
    const videoResults = this.plan.sources.map((s) => ({
      label: s.label,
      kind: 'video',
      file: s.outPath,
      mp4: s._mp4 || null,
      bytes: sizeOf(s.outPath),
      seconds: durs.get(s.label) ?? (this.stats.get(s.label) || {}).seconds ?? null,
      drop: (this.stats.get(s.label) || {}).drop ?? 0,
      startOffsetMs: offsetMs(s.label),
    }));
    const audioResults = this.plan.audio
      ? [
          {
            label: 'audio',
            kind: 'audio',
            file: this.plan.audio.outPath,
            mp4: null,
            bytes: sizeOf(this.plan.audio.outPath),
            seconds: durs.get('audio') ?? null,
            drop: 0,
            startOffsetMs: offsetMs('audio'),
            paddedMs: audioPaddedMs,
          },
        ]
      : [];
    this._results = [...videoResults, ...audioResults];
    this.emit('done', this._results);
    return this._results;
  }

  async _remux(source) {
    let exists = false;
    try {
      exists = fs.statSync(source.outPath).size > 0;
    } catch {}
    if (!exists) return; // nothing captured; skip
    const out = source.outPath.replace(/\.[^.]+$/, '.mp4');
    await new Promise((resolve) => {
      const child = spawn(this.ffmpegPath, buildRemuxArgs(source.outPath, out), {
        stdio: 'ignore',
      });
      child.on('error', () => resolve());
      child.on('exit', (code) => {
        if (code === 0) source._mp4 = out;
        resolve();
      });
    });
  }

  // Actual content duration via ffprobe (resolves null if ffprobe is missing/fails). Used
  // for end-alignment - more accurate than `-progress` out_time, which mis-times audio.
  _probeDurationSec(file) {
    const ffprobe = this.ffmpegPath.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(
          ffprobe === this.ffmpegPath ? 'ffprobe' : ffprobe,
          ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
          { stdio: ['ignore', 'pipe', 'ignore'] },
        );
      } catch {
        return resolve(null);
      }
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('error', () => resolve(null));
      child.on('exit', () => {
        const n = Number(String(out).trim());
        resolve(Number.isFinite(n) && n > 0 ? n : null);
      });
    });
  }

  // Prepend `ms` of silence to the mic file in place, so it lines up at the timeline start.
  async _padAudioFront(file, ms) {
    const tmp = file.replace(/\.wav$/i, '.aligned.wav');
    const ok = await new Promise((resolve) => {
      let child;
      try {
        child = spawn(
          this.ffmpegPath,
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-i',
            file,
            '-af',
            `adelay=${ms}:all=1`,
            '-y',
            tmp,
          ],
          { stdio: 'ignore' },
        );
      } catch {
        return resolve(false);
      }
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
    });
    if (ok) {
      try {
        fs.renameSync(tmp, file);
        return true;
      } catch {}
    }
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
    return false;
  }
}

// The pluggable engine seam. A future ObsEngine implements the same surface.
export class FfmpegEngine {
  constructor({ ffmpegPath = 'ffmpeg' } = {}) {
    this.ffmpegPath = ffmpegPath;
  }
  createRecording(plan) {
    return new Recorder(plan, { ffmpegPath: this.ffmpegPath });
  }
}
