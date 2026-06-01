// Build-time telemetry defaults.
//
// justroll ships as plain ESM with no bundler, so there is no `define` step to
// inject these. Instead this file is committed with EMPTY defaults (telemetry
// stays off in development unless you set the env vars), and the release publish
// workflow overwrites it with the real host + website id right before
// `npm publish`. The overwrite is never committed back.
export const BUILD_UMAMI_HOST = '';
export const BUILD_UMAMI_WEBSITE_ID = '';
