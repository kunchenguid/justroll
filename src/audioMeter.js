// Audio level math + a fixed-size history buffer for the waveform.

export function rmsFromS16LE(buf) {
  const n = Math.floor(buf.length / 2);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = buf.readInt16LE(i * 2) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

export function peakFromS16LE(buf) {
  const n = Math.floor(buf.length / 2);
  let p = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.abs(buf.readInt16LE(i * 2)) / 32768;
    if (s > p) p = s;
  }
  return p;
}

export function toDbfs(level) {
  if (level <= 0) return -Infinity;
  return 20 * Math.log10(level);
}

// Map a linear 0..1 amplitude onto a 0..1 display position using a dBFS floor,
// so quiet speech still produces visible movement.
export function levelToUnit(level, floorDb = -60) {
  if (level <= 0) return 0;
  const db = toDbfs(level);
  if (db <= floorDb) return 0;
  if (db >= 0) return 1;
  return (db - floorDb) / -floorDb;
}

export class RingBuffer {
  constructor(capacity) {
    this.capacity = Math.max(1, capacity | 0);
    this.buf = new Array(this.capacity).fill(0);
    this.size = 0;
    this.head = 0;
  }

  push(v) {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
    return this;
  }

  // Oldest -> newest.
  toArray() {
    const out = [];
    const start = (this.head - this.size + this.capacity) % this.capacity;
    for (let i = 0; i < this.size; i++) out.push(this.buf[(start + i) % this.capacity]);
    return out;
  }

  get length() {
    return this.size;
  }
}
