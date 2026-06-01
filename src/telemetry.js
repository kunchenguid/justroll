/**
 * Anonymous usage telemetry for justroll, sent to a self-hosted Umami instance.
 *
 * The wire format mirrors gnhf / no-mistakes telemetry: POST /api/send with
 * { type: "event", payload: { website, hostname, title, url, name, data,
 * timestamp } }. Events use a synthetic "app://justroll/<event>" URL so Umami
 * treats CLI events as distinct pages.
 *
 * Layering (highest wins): JUSTROLL_TELEMETRY=0|false|off opt-out, then
 * JUSTROLL_UMAMI_HOST/JUSTROLL_UMAMI_WEBSITE_ID env vars, then build-time
 * defaults from telemetry-defaults.js, then a hard-coded host fallback.
 *
 * No titles, device names, file paths, or any personal data are ever sent.
 */
import { BUILD_UMAMI_HOST, BUILD_UMAMI_WEBSITE_ID } from './telemetry-defaults.js';

const HARDCODED_FALLBACK_HOST = 'https://a.kunchenguid.com';
const UMAMI_PATH = '/api/send';
const DEFAULT_HOSTNAME = 'cli';
const DEFAULT_TITLE = 'justroll CLI';
const DEFAULT_REQUEST_TIMEOUT_MS = 1_000;

export function resolveTelemetryConfig({ env, buildHost, buildWebsiteID }) {
  const optOut = (env.JUSTROLL_TELEMETRY ?? '').trim().toLowerCase();
  if (optOut === '0' || optOut === 'false' || optOut === 'off') {
    return { enabled: false, host: '', websiteID: '' };
  }

  const websiteID = (env.JUSTROLL_UMAMI_WEBSITE_ID ?? '').trim() || buildWebsiteID.trim();
  if (!websiteID) {
    return { enabled: false, host: '', websiteID: '' };
  }

  const host =
    (env.JUSTROLL_UMAMI_HOST ?? '').trim() || buildHost.trim() || HARDCODED_FALLBACK_HOST;

  return { enabled: true, host, websiteID };
}

function normalizeEndpoint(host) {
  let url;
  try {
    url = new URL(host.trim());
  } catch {
    return null;
  }
  if (!url.protocol || !url.host) return null;
  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = pathname.endsWith(UMAMI_PATH) ? pathname : pathname + UMAMI_PATH;
  return url.toString();
}

function eventURL(app, name) {
  if (!name) return `app://${app}`;
  return `app://${app}/${name.replace(/\./g, '/')}`;
}

function normalizePagePath(path) {
  const trimmed = path.trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

class NoopClient {
  track() {}
  pageview() {}
  async close() {}
}

class HttpClient {
  constructor(endpoint, config) {
    this.endpoint = endpoint;
    this.websiteID = config.websiteID;
    this.app = config.app;
    this.version = config.version;
    this.userAgent = `${config.app}/${config.version} telemetry`;
    this.platform = config.platform ?? '';
    this.arch = config.arch ?? '';
    this.fetchImpl = config.fetch ?? fetch;
    this.timeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.inFlight = new Set();
    this.closed = false;
  }

  track(name, fields = {}) {
    if (this.closed) return;
    const trimmed = String(name ?? '').trim();
    if (!trimmed) return;
    this.send(trimmed, eventURL(this.app, trimmed), fields);
  }

  pageview(path, fields = {}) {
    if (this.closed) return;
    this.send('', normalizePagePath(path), fields);
  }

  async close(timeoutMs = 1_000) {
    this.closed = true;
    if (this.inFlight.size === 0) return;
    const drained = Promise.allSettled(Array.from(this.inFlight)).then(() => undefined);
    if (timeoutMs <= 0) return;
    await Promise.race([
      drained,
      new Promise((resolve) => {
        setTimeout(resolve, timeoutMs).unref?.();
      }),
    ]);
  }

  send(name, url, fields) {
    const data = { ...fields };
    if (this.platform && data.platform === undefined) data.platform = this.platform;
    if (this.arch && data.arch === undefined) data.arch = this.arch;
    if (data.version === undefined) data.version = this.version;

    const payload = {
      type: 'event',
      payload: {
        website: this.websiteID,
        hostname: DEFAULT_HOSTNAME,
        title: DEFAULT_TITLE,
        url,
        name,
        data,
        timestamp: Math.floor(Date.now() / 1000),
      },
    };

    let body;
    try {
      body = JSON.stringify(payload);
    } catch {
      return;
    }

    const promise = this.fire(body);
    this.inFlight.add(promise);
    promise.finally(() => this.inFlight.delete(promise));
  }

  async fire(body) {
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': this.userAgent },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      try {
        await response.body?.cancel?.();
      } catch {
        // ignore
      }
    } catch {
      // Telemetry is best-effort.
    }
  }
}

export function createTelemetryClient(config) {
  if (!config.enabled) return new NoopClient();
  const endpoint = normalizeEndpoint(config.host);
  if (!endpoint || !config.websiteID) return new NoopClient();
  return new HttpClient(endpoint, config);
}

let defaultClient = null;

export function initDefaultTelemetry(init) {
  const resolved = resolveTelemetryConfig({
    env: init.env ?? process.env,
    buildHost: BUILD_UMAMI_HOST,
    buildWebsiteID: BUILD_UMAMI_WEBSITE_ID,
  });
  defaultClient = createTelemetryClient({
    enabled: resolved.enabled,
    host: resolved.host,
    websiteID: resolved.websiteID,
    app: init.app,
    version: init.version,
    platform: init.platform,
    arch: init.arch,
  });
  return defaultClient;
}

export function getDefaultTelemetry() {
  return defaultClient ?? new NoopClient();
}

/** Test-only: reset the module-level singleton between tests. */
export function resetDefaultTelemetryForTests() {
  defaultClient = null;
}
