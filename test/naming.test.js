import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify,
  dateStamp,
  sessionDirName,
  uniqueDirName,
  assignLabels,
  fileName,
} from '../src/naming.js';

test('slugify normalizes titles', () => {
  assert.equal(slugify('Leave Big Tech 2'), 'leave-big-tech-2');
  assert.equal(slugify('  Hello,  World!! '), 'hello-world');
  assert.equal(slugify('A//B**C'), 'a-b-c');
  assert.equal(slugify(''), 'untitled');
  assert.equal(slugify('---'), 'untitled');
});

test('dateStamp zero-pads', () => {
  assert.equal(dateStamp(new Date(2026, 5, 1)), '2026-06-01');
  assert.equal(dateStamp(new Date(2026, 11, 25)), '2026-12-25');
});

test('sessionDirName combines date and slug', () => {
  assert.equal(
    sessionDirName('Leave Big Tech 2', new Date(2026, 5, 1)),
    '2026-06-01_leave-big-tech-2',
  );
});

test('uniqueDirName appends suffix on collision', () => {
  const taken = new Set(['x', 'x-2', 'x-3']);
  assert.equal(
    uniqueDirName('x', (n) => taken.has(n)),
    'x-4',
  );
  assert.equal(
    uniqueDirName('y', (n) => taken.has(n)),
    'y',
  );
});

test('assignLabels numbers screens and names single camera', () => {
  const out = assignLabels([
    { type: 'screen', deviceIndex: 1 },
    { type: 'screen', deviceIndex: 2 },
    { type: 'camera', deviceIndex: 0 },
  ]);
  assert.deepEqual(
    out.map((s) => s.label),
    ['screen-0', 'screen-1', 'camera'],
  );
});

test('assignLabels numbers multiple cameras', () => {
  const out = assignLabels([
    { type: 'camera', deviceIndex: 0 },
    { type: 'camera', deviceIndex: 3 },
  ]);
  assert.deepEqual(
    out.map((s) => s.label),
    ['camera-0', 'camera-1'],
  );
});

test('fileName joins label and container', () => {
  assert.equal(fileName('screen-0', 'mkv'), 'screen-0.mkv');
});
