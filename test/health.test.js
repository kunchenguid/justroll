import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIssues, nearestExistingDir, LOW_DISK_BYTES } from '../src/health.js';

test('buildIssues flags an unwritable recordings dir', () => {
  const issues = buildIssues(
    { dir: '/nope', writable: false, freeBytes: 1e12 },
    { micSelected: true },
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].level, 'error');
  assert.match(issues[0].text, /Can't write/);
});

test('buildIssues warns on low disk', () => {
  const issues = buildIssues(
    { dir: '/x', writable: true, freeBytes: LOW_DISK_BYTES - 1 },
    { micSelected: true },
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].level, 'warn');
  assert.match(issues[0].text, /Low disk/);
});

test('buildIssues warns when no mic is selected', () => {
  const issues = buildIssues(
    { dir: '/x', writable: true, freeBytes: 1e12 },
    { micSelected: false },
  );
  assert.match(issues[0].text, /No microphone/);
});

test('buildIssues is empty when everything is fine', () => {
  assert.deepEqual(
    buildIssues({ dir: '/x', writable: true, freeBytes: 1e12 }, { micSelected: true }),
    [],
  );
});

test('nearestExistingDir walks up to a real directory', () => {
  const d = nearestExistingDir('/tmp/justroll-does-not-exist/a/b/c');
  assert.ok(d && d.length > 0);
  assert.ok('/tmp/justroll-does-not-exist/a/b/c'.startsWith(d));
});
