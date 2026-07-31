# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## What this is

`justroll` is a macOS CLI that records every selected screen and camera to its own clean file in one command.
Each clip carries a copy of the same microphone track, so any editor's "sync by audio" lines them up without timecode gear.
It is a single-package ESM Node project (`"type": "module"`, Node >= 20) using **ink** + **React** (via `htm`, not JSX) for the terminal UI, and **ffmpeg** as the only runtime dependency.

## Commands

```sh
pnpm install               # uses pnpm (packageManager pinned); pnpm-workspace.yaml present
pnpm test                  # node --test over test/*.test.js
node --test test/plan.test.js          # run a single test file
node --test --test-name-pattern "groups all screens"   # run one test by name
pnpm run lint              # eslint src bin test scripts
pnpm run format            # prettier --write
pnpm run format:check      # prettier --check (CI uses this)
pnpm run demo              # live UI with a synthetic engine, records nothing
pnpm run selftest          # headless real-device capture that verifies the pipeline
make demo                  # regenerate demo.gif/demo.mp4 (needs vhs + ffmpeg)
```

Per Kun's global instructions: use TDD for features and bug fixes; tests live in `test/` mirroring `src/` module names.

## Architecture

The codebase is split into **pure, testable logic** (most of `src/`) and **side-effecting edges** (process spawning in `recorder.js`, device enumeration in `devices.js`, the ink UI, and `bin/justroll.js`). Almost everything that builds an ffmpeg command, a path, or a UI decision is a pure function so it can be unit-tested without a device.

### The recording pipeline (data flow)

1. **`bin/justroll.js`** — entry point. Parses argv, loads config, checks ffmpeg, enumerates devices, then renders the ink `App` (or runs `--selftest`/`--demo` headless/synthetic paths). Holds the CLI flags (`--dir`, `--no-mp4`, `--fps`, `--seconds`, `--selftest`, `--demo`).
2. **`devices.js`** — `enumerateDevices()` shells `ffmpeg -list_devices` and `parseDeviceList()` parses its stderr into `{ video:[{index,name,kind}], audio }`. `kind` is `screen` vs `camera` by name match. Indexes drift on replug, so devices are remembered by **name** and re-resolved via `resolveDeviceIndex`. **Camera/capture-card framerates** are mode-locked (a card may only do `1080p60`), so `probeVideoModes()` provokes ffmpeg's "Supported modes" listing (by requesting an impossible 1 fps) and `pickFramerate()` picks a supported rate; an empty list means the device won't open. **Never probe a screen this way** — a screen might actually start a 1 fps capture and hang.
3. **`plan.js`** — `buildPlan()` turns wizard selections + config into a fully-resolved plan: every directory, ffmpeg input index, output filename, and label decided **up front**. This is the contract every downstream piece consumes. `ensurePlanDirs()` creates `dir/{raw,exports,project}`.
4. **`naming.js`** — pure title→filesystem naming: `slugify`, `sessionDirName` (`YYYY-MM-DD_slug`), `uniqueDirName` (collision suffixing), `assignLabels` (`screen-0`, `screen-1`, `camera`/`camera-0`).
5. **`ffmpegArgs.js`** — **pure** ffmpeg argv builders, the heart of the tool. `buildJobArgs` (grouped **video-only** job), `buildAudioRecordArgs` (the mic's own isolated PCM file), `buildRecordArgs` (single source, legacy/tests), `buildAudioTapArgs` (PCM tap for the meter), `buildRemuxArgs` (MKV→MP4), and `parseProgress`/`normalizeProgress` for `-progress pipe:1`. Side-effect free — never spawns.
6. **`recorder.js`** — the only place processes are spawned. `Recorder` (an `EventEmitter`) runs the plan as **independent processes**: video-only capture jobs + the mic's own `buildAudioRecordArgs` process + a decoupled `startMicTap` for the live waveform. It polls per-file byte sizes from the filesystem + fps/drop from each progress stream, estimates each stream's start wall-clock from `-progress` (`_recordT0`) for cross-file `startOffsetMs` alignment, and tears down cleanly on `stop()` (`q` to stdin → SIGINT → SIGKILL), then remuxes video to MP4. `FfmpegEngine` is the **pluggable engine seam** (`createRecording(plan)`); `MockEngine` and a future `ObsEngine` implement the same surface.
7. **`session.js`** — writes the artifacts: `session.json` manifest (`buildSessionManifest`) and human-readable `notes.md` sync recipe (`buildNotesMarkdown`).
8. **`thumbnail.js`** — **pure** pixel→terminal rendering. `renderRgbHalfBlocks()` turns a raw RGB24 frame into half-block (`▀`) lines with 24-bit ANSI color (top pixel = foreground, bottom = background, doubling vertical resolution); `syntheticThumbnail()` fakes one for `--demo`. Paired with `buildScreenThumbnailArgs` (ffmpegArgs) + `grabScreenThumbnail` (recorder) to show **per-device previews of both the cameras and screens steps**, so identical monitors (or an ambiguous capture card) are told apart by their actual content, not a useless "Capture screen N" label. Camera grabs use the device's probed framerate.

### The macOS screen-capture invariant (critical, do not break)

macOS **hangs** if two avfoundation screen-capture _processes_ run at once. So `buildJobs()` (in `recorder.js`) groups **all** avfoundation screens into a **single** video-only ffmpeg process with one mapped output per screen, while each camera (and each synthetic source) gets its own process so a dead capture-card can't stall the screens. `buildJobArgs` emits one input per video, then a `-map ${i}:v` output block per source — **never any audio**. Any change to grouping must preserve this.

### Other invariants worth knowing

- **Separate clean processes — the audio model (do not collapse):** every video is captured **video-only**; the mic records in its **own isolated process** (`buildAudioRecordArgs` → `raw/audio.wav`, lossless PCM). This is deliberate and hard-won: muxing the mic into a video process made one ffmpeg simultaneously hardware-encode, capture a second device's (drifting) clock, and feed the TUI — which produced dropped-sample **static** and **A/V drift**. Do **not** reintroduce muxing audio into a video file, and do **not** tee the meter out of a kept recording (pipe back-pressure from the TUI stalls the whole process). The live waveform comes from a **separate decoupled tap** (`startMicTap`) whose hiccups can't touch a recording. `-thread_queue_size 1024` on every live input.
- **Duration alignment, not muxed audio:** every process gets `q` at the same instant, so content **ends** are synchronized and a shorter file just **started later** (device warmup). `stop()` ffprobes each output's real duration (`_probeDurationSec` — more accurate than progress `out_time`, which mis-times audio) and end-aligns: `startOffsetMs = maxDur - dur` (ms after the earliest clip), on every result + in `session.json`/`notes.md`. The mic's warmup-shortened front is then padded with silence (`_padAudioFront`, an `adelay` re-mux) so `audio.wav` drops in at 0 with no nudging; `paddedMs` records how much. Do **not** revive the old `now - out_time` timestamp estimate — avfoundation audio PTS includes a warmup gap the WAV drops, so it mis-aligned.
- **macOS input volume:** ffmpeg's avfoundation capture ignores the Sound-settings input-volume slider, so we read it (`macInputVolume` via osascript) and apply it as `-af volume=` in `buildAudioRecordArgs`. It only applies when the selected mic is the **default input** (`defaultInputName` via system_profiler — the slider only controls that device); `resolveMicGain` handles the matching and the `config.audioGain` override. Resolved on the review step in `App` and passed as `mic.gain → plan.audio.gain`.
- **Crash-safe video:** video captures to MKV (survives an abrupt kill) and remuxes to MP4 with **lossless `-c:v copy`** (audio re-encode in `buildRemuxArgs` is a no-op now that video files have no audio). The audio file is PCM WAV, finalized on the clean `q` stop. Remux is toggleable via the review screen / `--no-mp4`.
- **Camera framerate + pixel format:** capture cards are mode-locked (e.g. 1080p60) — `probeVideoModes`/`pickFramerate` (`devices.js`) pick a supported rate per camera (`s.fps`, applied in `App.startRecording`); screens use the global `settings.fps`. Screens **and** capture cards reject ffmpeg's default `yuv420p`, so recording (`buildJobArgs`) and the thumbnail grab (`buildScreenThumbnailArgs`) force `-pixel_format nv12` before `-i`.
- **Progress on stdout, stop on stdin:** ffmpeg gets `-progress pipe:1` so stdin stays free for the clean `q` quit.
- **Synthetic fallback:** when no screens are exposed (display asleep/locked or permission off), `--selftest` substitutes a `lavfi testsrc` source so the full orchestration still gets exercised. The `inputFormat`/`inputSpec` fields on a source switch a builder from avfoundation to a generic input.
- **Sequential thumbnail grabs:** the wizard's screen previews (`grabScreenThumbnail`) MUST be grabbed one at a time — this is the same no-two-concurrent-screen-captures invariant as recording. The `App` effect awaits each grab in a `for` loop; never `Promise.all` them. Previews need a 24-bit-color terminal (`getColorDepth() >= 24`) and fall back to plain text labels otherwise.

### UI (`src/ui/`)

ink + React written with `htm` template literals (`html\`...\``) — there is **no JSX/build step**, `h.js`exports`html`and`React`. `App.js`is a state machine:`phase` (`wizard|recording|stopping|done|error`) × `step`(0 mic, 1 cameras, 2 screens, 3 review). Keyboard via`useInput`. `Waveform.js`renders the live mic meter (a`RingBuffer`of levels from`audioMeter.js`). `mockEngine.js`/`mockDevices.js`drive`--demo`and UI tests without ffmpeg.`health.js` produces the inline readiness warnings (low disk, unwritable dir, no mic) shown in the wizard — there is deliberately no separate "doctor" command.

### Config & telemetry

- **`config.js`** — `~/.config/justroll/config.json` shallow-merged over `DEFAULT_CONFIG` (`mergeConfig` merges nested objects one level deep). `expandHome` handles `~`. CLI flags override config in `bin/justroll.js`'s `applyOverrides`.
- **`telemetry.js`** — anonymous counts only (screens/cameras/fps/duration), POSTed to a self-hosted Umami. **Never** sends titles, device names, or paths. Opt out with `JUSTROLL_TELEMETRY=0`. `telemetry-defaults.js` holds build-time host/website-id defaults.

## Conventions

- ESM only, Node built-ins via `node:` prefix. Comments explain _why_ (especially the platform quirks) — keep that style.
- Releases are automated by **release-please**; do not hand-edit `CHANGELOG.md` or version fields.
- PR workflows ignore release-please outputs via `paths-ignore` so release PRs create zero runs; keep that set complete with `scripts/check-release-ci-exclusions.sh` (wired early in `ci.yml`).
- Prettier + eslint are enforced in CI (`.github/workflows/ci.yml`); `format:check` must pass.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
