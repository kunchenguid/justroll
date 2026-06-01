<h1 align="center">justroll</h1>
<p align="center">
  <a href="https://github.com/kunchenguid/justroll/actions/workflows/ci.yml"
    ><img
      alt="CI"
      src="https://img.shields.io/github/actions/workflow/status/kunchenguid/justroll/ci.yml?style=flat-square&label=ci"
  /></a>
  <a href="https://github.com/kunchenguid/justroll/actions/workflows/release-please.yml"
    ><img
      alt="Release"
      src="https://img.shields.io/github/actions/workflow/status/kunchenguid/justroll/release-please.yml?style=flat-square&label=release"
  /></a>
  <a href="https://www.npmjs.com/package/justroll"
    ><img alt="npm" src="https://img.shields.io/npm/v/justroll?style=flat-square"
  /></a>
  <a href="https://img.shields.io/badge/platform-macOS-blue?style=flat-square"
    ><img
      alt="Platform"
      src="https://img.shields.io/badge/platform-macOS-blue?style=flat-square"
  /></a>
  <a href="https://x.com/kunchenguid"
    ><img alt="X" src="https://img.shields.io/badge/X-@kunchenguid-black?style=flat-square"
  /></a>
  <a href="https://discord.gg/Wsy2NpnZDu"
    ><img
      alt="Discord"
      src="https://img.shields.io/discord/1439901831038763092?style=flat-square&label=discord"
  /></a>
</p>

<h3 align="center">We're rolling. One command records every screen and your camera to its own clean file.</h3>

<p align="center">
  <img src="https://raw.githubusercontent.com/kunchenguid/justroll/main/demo.gif" alt="justroll demo" width="800" />
</p>

You want to record a talking-head video over a couple of screens.
So you wrangle OBS scenes, or you screen-record one display and forget the second, and then you spend the evening nudging clips around a timeline trying to line up audio.

`justroll` is a single terminal command.
It opens a wizard, you pick your mic and which screens and camera to capture, and it records each source to its own file - all carrying a copy of the same microphone, so your editor snaps them into sync automatically.

- **One file per source** — every screen and the camera record independently, hardware-encoded. Nothing is composited, so you cut them however you want.
- **Sync without a clapperboard** — the same mic is muxed into every clip, so any editor's "synchronize by audio" lines them up. No timecode gear.
- **Honest about macOS** — it groups screens into one ffmpeg process (concurrent screen captures deadlock otherwise), and the wizard tells you up front when a mic is silent, a display is locked, or a permission is missing.

## Quick Start

```sh
$ brew install ffmpeg          # the only dependency
$ npm install -g justroll

$ justroll "Tutorial Take 1"   # opens the wizard: pick mic, cameras, screens
# ...record. watch the live waveform. press Ctrl+C (or q) to stop & finalize...

$ ls ~/Recordings/2026-06-01_tutorial-take-1/raw
camera.mkv   camera.mp4   screen-0.mkv   screen-0.mp4   screen-1.mkv   screen-1.mp4
```

## Install

**npm** (requires macOS, Node 20+, and [ffmpeg](https://ffmpeg.org)):

```sh
brew install ffmpeg
npm install -g justroll
```

**From source:**

```sh
git clone https://github.com/kunchenguid/justroll
cd justroll
pnpm install
pnpm link --global   # puts `justroll` on your PATH
```

First run will trigger macOS prompts for Screen Recording, Camera, and Microphone.
Screen Recording in particular must be granted to your terminal in System Settings → Privacy & Security, then the terminal restarted.

## How It Works

```
  justroll "title"
        │
        ▼
  ┌───────────────┐   pick mic, cameras, screens
  │    wizard     │   live mic meter + readiness checks
  └───────┬───────┘
          │ start
          ▼
  ┌───────────────────────────────┐      ┌──────────────┐
  │  all screens → ONE ffmpeg proc │      │  audio tap   │
  │  each camera → its own proc    │ ───► │  live wave   │
  │  (same mic muxed into each)    │      └──────────────┘
  └───────┬───────────────────────┘
          │ Ctrl+C / q  →  clean finalize
          ▼
  raw/screen-0.mkv  raw/camera.mkv  ...  (+ .mp4, session.json, notes.md)
          │
          ▼
  import the folder → your editor's sync-by-audio aligns every clip
```

- **Screens share a process.** macOS hangs when two avfoundation screen-capture processes run at once, so justroll records all screens from a single ffmpeg with one mapped output per screen. Cameras stay separate, so a dead capture-card can't stall the screens.
- **Crash-safe, then convenient.** It records to MKV (survives an abrupt kill) and remuxes to MP4 after you stop. Toggle the remux in the review screen.
- **VideoToolbox encoding.** `h264_videotoolbox` keeps capture light on CPU.
- **It tells you when something's wrong.** A live mic meter, empty-device guidance, low-disk/permission warnings, and per-source `no frames` / `dropped` flags during recording - no separate "doctor" command.

## CLI Reference

| Command               | Description                                              |
| --------------------- | ------------------------------------------------------- |
| `justroll "title"`    | Start the recording wizard                              |
| `justroll --selftest` | Headless capture that verifies the full pipeline        |
| `justroll --demo`     | Live UI preview with a synthetic engine (records nothing) |
| `justroll --help`     | Show help                                               |
| `justroll --version`  | Print the version                                       |

### Flags

| Command       | Flag             | Description                              |
| ------------- | ---------------- | ---------------------------------------- |
| `justroll`    | `--dir <path>`   | Override the recordings directory        |
| `justroll`    | `--no-mp4`       | Keep MKV only (skip the mp4 remux)       |
| `justroll`    | `--fps <n>`      | Capture frame rate (24/30/48/60)         |
| `--selftest`  | `--seconds <n>`  | Capture duration for the self-test       |

In the wizard: `↑↓` move, `space` toggle a camera/screen, `←→` change a setting, `enter` advance/start, `esc` back, `q` quit. While recording: `Ctrl+C` stop & review, `q` stop & quit.

## Configuration

Optional, at `~/.config/justroll/config.json` (defaults shown):

```json
{
  "recordingsDir": "~/Recordings",
  "video": { "fps": 30, "codec": "h264_videotoolbox", "container": "mkv", "pixelFormat": "nv12" },
  "remuxToMp4": true,
  "defaults": { "mic": "RODE NT-USB", "embedMicInEveryFile": true }
}
```

## Development

```sh
pnpm test            # unit + UI tests (node:test + ink-testing-library)
pnpm run lint        # eslint
pnpm run format      # prettier --write
pnpm run demo        # live UI preview, records nothing
pnpm run selftest    # headless pipeline check against your real devices
make demo            # regenerate demo.gif + demo.mp4 (needs vhs + ffmpeg)
```

## Telemetry

`justroll` sends anonymous usage counts to my self-hosted analytics so I can see what's actually getting used - number of screens/cameras, fps, duration.
No titles, device names, or file paths are ever sent.
Set `JUSTROLL_TELEMETRY=0` to turn it off.
