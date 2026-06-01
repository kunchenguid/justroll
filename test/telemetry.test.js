import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTelemetryConfig, createTelemetryClient } from '../src/telemetry.js';

const base = { env: {}, buildHost: '', buildWebsiteID: '' };

test('telemetry is disabled when no website id is available', () => {
  const c = resolveTelemetryConfig(base);
  assert.equal(c.enabled, false);
});

test('JUSTROLL_TELEMETRY opt-out wins over everything', () => {
  for (const v of ['0', 'false', 'off', 'OFF']) {
    const c = resolveTelemetryConfig({
      env: { JUSTROLL_TELEMETRY: v, JUSTROLL_UMAMI_WEBSITE_ID: 'abc' },
      buildHost: 'https://h',
      buildWebsiteID: 'build',
    });
    assert.equal(c.enabled, false, `opt-out value ${v}`);
  }
});

test('env vars override build defaults; host falls back to the hardcoded default', () => {
  const c = resolveTelemetryConfig({
    env: { JUSTROLL_UMAMI_WEBSITE_ID: 'env-id' },
    buildHost: '',
    buildWebsiteID: 'build-id',
  });
  assert.equal(c.enabled, true);
  assert.equal(c.websiteID, 'env-id');
  assert.equal(c.host, 'https://a.kunchenguid.com');
});

test('build defaults enable telemetry when env is unset', () => {
  const c = resolveTelemetryConfig({
    env: {},
    buildHost: 'https://example.test',
    buildWebsiteID: 'build-id',
  });
  assert.deepEqual(c, { enabled: true, host: 'https://example.test', websiteID: 'build-id' });
});

test('a disabled client is a no-op', async () => {
  const client = createTelemetryClient({ enabled: false });
  client.track('record', { screens: 2 });
  await client.close(0);
});

test('an enabled client POSTs an Umami event with only the fields we pass', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { body: { cancel: async () => {} } };
  };
  const client = createTelemetryClient({
    enabled: true,
    host: 'https://a.example.com',
    websiteID: 'wid-123',
    app: 'justroll',
    version: '9.9.9',
    platform: 'darwin',
    arch: 'arm64',
    fetch: fakeFetch,
  });
  client.track('record', { screens: 2, cameras: 1, fps: 30 });
  await client.close(1000);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://a.example.com/api/send');
  const p = calls[0].body.payload;
  assert.equal(calls[0].body.type, 'event');
  assert.equal(p.website, 'wid-123');
  assert.equal(p.name, 'record');
  assert.equal(p.url, 'app://justroll/record');
  assert.equal(p.data.screens, 2);
  assert.equal(p.data.platform, 'darwin');
  assert.equal(p.data.version, '9.9.9');
  // no title/path/device fields leak in
  assert.ok(!('title' in p.data) && !('path' in p.data));
});
