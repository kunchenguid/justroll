import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmsFromS16LE, peakFromS16LE, toDbfs, levelToUnit, RingBuffer } from '../src/audioMeter.js';

function s16(samples) {
  const b = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => b.writeInt16LE(v, i * 2));
  return b;
}

test('rms and peak of silence is zero', () => {
  const b = s16([0, 0, 0, 0]);
  assert.equal(rmsFromS16LE(b), 0);
  assert.equal(peakFromS16LE(b), 0);
});

test('peak finds the loudest sample', () => {
  const b = s16([0, 16384, -32768, 100]);
  assert.equal(peakFromS16LE(b), 1); // -32768 -> 1.0
});

test('rms of full-scale square wave approaches 1', () => {
  const b = s16(new Array(64).fill(32767));
  assert.ok(rmsFromS16LE(b) > 0.99);
});

test('toDbfs maps levels', () => {
  assert.equal(toDbfs(1), 0);
  assert.ok(Math.abs(toDbfs(0.5) + 6.02) < 0.05);
  assert.equal(toDbfs(0), -Infinity);
});

test('levelToUnit floors quiet signals and clamps loud ones', () => {
  assert.equal(levelToUnit(0), 0);
  assert.equal(levelToUnit(1), 1);
  assert.ok(levelToUnit(0.5) > 0 && levelToUnit(0.5) < 1);
});

test('RingBuffer keeps the most recent N in order', () => {
  const r = new RingBuffer(3);
  r.push(1).push(2).push(3).push(4);
  assert.deepEqual(r.toArray(), [2, 3, 4]);
  assert.equal(r.length, 3);
});
