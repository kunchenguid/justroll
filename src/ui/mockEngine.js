// A drop-in engine for --demo and visual tests: emits a lifelike waveform and
// growing stats without spawning ffmpeg or touching capture devices.
import { EventEmitter } from 'node:events';

class MockRecorder extends EventEmitter {
  constructor(plan) {
    super();
    this.plan = plan;
    this.startedAt = null;
    this.endedAt = null;
    this._timers = [];
    this._bytes = new Map(plan.sources.map((s) => [s.label, 0]));
    this._t = 0;
  }

  start() {
    this.startedAt = new Date().toISOString();
    // waveform: speech-like envelope (syllables) + noise
    this._timers.push(
      setInterval(() => {
        this._t += 0.05;
        const syl = Math.abs(Math.sin(this._t * 3)) * Math.abs(Math.sin(this._t * 0.7));
        const noise = 0.06 * Math.abs(Math.sin(this._t * 41.3));
        const unit = Math.min(1, syl * 0.85 + noise);
        this.emit('level', { unit, rms: unit, peak: Math.min(1, unit + 0.1) });
      }, 50),
    );
    // stats: grow bytes + steady fps
    this._timers.push(
      setInterval(() => {
        for (const s of this.plan.sources) {
          const b = this._bytes.get(s.label) + Math.round(900000 + Math.random() * 200000);
          this._bytes.set(s.label, b);
          this.emit('stats', {
            label: s.label,
            stats: { bytes: b, fps: 29.9 + Math.random() * 0.2, drop: 0, seconds: this._t },
          });
        }
      }, 250),
    );
    this.emit('start', { startedAt: this.startedAt });
    return this;
  }

  async stop() {
    this._timers.forEach(clearInterval);
    this._timers = [];
    await new Promise((r) => setTimeout(r, 500)); // mimic finalize
    this.endedAt = new Date().toISOString();
    return this.plan.sources.map((s) => ({
      label: s.label,
      file: s.outPath,
      mp4: this.plan.settings.remuxToMp4 ? s.outPath.replace(/\.[^.]+$/, '.mp4') : null,
      bytes: this._bytes.get(s.label),
      seconds: this._t,
      drop: 0,
    }));
  }
}

export class MockEngine {
  createRecording(plan) {
    return new MockRecorder(plan);
  }
}
