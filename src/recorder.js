// The FfmpegEngine: spawns capture "jobs" plus a shared audio tap for the waveform,
// parses live progress, and tears everything down cleanly on stop.
//
// macOS will hang if two avfoundation screen-capture processes run at once, so all
// screens are recorded by ONE ffmpeg process with one mapped output per screen.
// Each camera (and each synthetic self-test source) gets its own process, which keeps
// a dead capture-card from taking the screens down with it.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import {
  buildJobArgs,
  buildAudioTapArgs,
  buildRemuxArgs,
  parseProgress,
  normalizeProgress,
} from './ffmpegArgs.js';
import { rmsFromS16LE, peakFromS16LE, levelToUnit } from './audioMeter.js';

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
    for (const job of this.jobs) {
      const args = buildJobArgs(job, this.plan.settings, this.plan.mic);
      const child = spawn(this.ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      this.stderr.set(job.id, '');
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        this.jobProgress.set(job.id, {
          ...(this.jobProgress.get(job.id) || {}),
          ...normalizeProgress(parseProgress(chunk)),
        });
      });
      child.stderr.on('data', (d) => this.stderr.set(job.id, this.stderr.get(job.id) + d));
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
    this._startTap();
    this.emit('start', { startedAt: this.startedAt });
    return this;
  }

  _failJob(job, error) {
    for (const s of job.sources) this.emit('source-error', { label: s.label, error });
  }

  // Per-file byte sizes come from the filesystem (a grouped process reports only
  // aggregate progress), while fps/drop come from that job's progress stream.
  _startStatPoll() {
    const poll = () => {
      for (const s of this.plan.sources) {
        const jp = this.jobProgress.get(this.jobOf.get(s.label)) || {};
        let bytes = null;
        try {
          bytes = fs.statSync(s.outPath).size;
        } catch {}
        const stats = {
          bytes,
          fps: jp.fps ?? null,
          drop: jp.drop ?? null,
          seconds: jp.seconds ?? null,
        };
        this.stats.set(s.label, stats);
        this.emit('stats', { label: s.label, stats });
      }
    };
    this.statTimer = setInterval(poll, 400);
  }

  _startTap() {
    if (this.plan.mic == null) return;
    this.tap = spawnMicTap(this.ffmpegPath, this.plan.mic.index, (lvl) => this.emit('level', lvl));
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
      for (const s of this.plan.sources) await this._remux(s);
    }

    this.endedAt = new Date().toISOString();
    this._results = this.plan.sources.map((s) => {
      const st = this.stats.get(s.label) || {};
      let bytes = st.bytes;
      try {
        bytes = fs.statSync(s.outPath).size;
      } catch {}
      return {
        label: s.label,
        file: s.outPath,
        mp4: s._mp4 || null,
        bytes: bytes ?? null,
        seconds: st.seconds ?? null,
        drop: st.drop ?? 0,
      };
    });
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
