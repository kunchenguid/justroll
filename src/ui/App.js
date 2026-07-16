import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { html, React } from './h.js';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { C, G, accentForType } from './theme.js';
import { Frame, HintBar, Row, SettingRow, StepDots } from './components.js';
import { Waveform } from './Waveform.js';
import { buildPlan, ensurePlanDirs } from '../plan.js';
import { assignLabels } from '../naming.js';
import {
  probeVideoModes,
  pickFramerate,
  macInputVolume,
  defaultInputName,
  resolveMicGain,
} from '../devices.js';
import { FfmpegEngine, startMicTap, grabScreenThumbnail } from '../recorder.js';
import { buildNotesMarkdown, buildSessionManifest } from '../session.js';
import { toDbfs } from '../audioMeter.js';
import { syntheticThumbnail } from '../thumbnail.js';
import { buildIssues } from '../health.js';

const { useState, useEffect, useRef } = React;

const fmtBytes = (n) => {
  if (n == null) return '--';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
};
const fmtDur = (sec) => {
  if (sec == null) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const pad = (x) => String(x).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

export default function App({
  title,
  devices,
  config,
  ffmpegPath = 'ffmpeg',
  engine = null,
  health = null,
  telemetry = null,
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = (stdout && stdout.columns) || 80;
  const waveWidth = Math.max(24, Math.min(cols - 8, 96));
  const contentWidth = Math.max(40, Math.min(cols - 6, 120));
  const wordmark = html`<${Text} bold=${true} color="cyanBright">justroll</${Text}>`;

  const cameras = devices.video.filter((d) => d.kind === 'camera');
  const screens = devices.video.filter((d) => d.kind === 'screen');
  const audio = devices.audio;

  const defaultMic = audio.find((a) => a.name === config.defaults?.mic) || audio[0] || null;

  const [phase, setPhase] = useState('wizard'); // wizard|recording|stopping|done|error
  const [step, setStep] = useState(0); // 0 mic, 1 cameras, 2 screens, 3 review
  const [cursor, setCursor] = useState(() => {
    const i = audio.findIndex((a) => defaultMic && a.index === defaultMic.index);
    return i < 0 ? 0 : i;
  });
  const [micIdx, setMicIdx] = useState(defaultMic ? defaultMic.index : null);
  const [camSel, setCamSel] = useState(() => new Set());
  const [scrSel, setScrSel] = useState(() => new Set(screens[0] ? [screens[0].index] : []));
  const [mp4, setMp4] = useState(config.remuxToMp4 !== false);
  const [fps, setFps] = useState(config.video.fps || 30);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);

  // Per-device preview thumbnails (index -> { status, lines }) so screens AND cameras
  // are identifiable by what they actually show, not a bare "screen 0" / device name.
  const [thumbs, setThumbs] = useState(() => new Map());
  const thumbsStartedRef = useRef(new Set()); // device indexes we've already grabbed
  const cameraFpsRef = useRef(new Map()); // camera index -> supported fps, or null if unavailable
  const aliveRef = useRef(true);
  useEffect(() => () => void (aliveRef.current = false), []); // unmount only
  // Demo always previews (synthetic, no capture); real runs need true-color support.
  const canThumb =
    (screens.length > 0 || cameras.length > 0) &&
    (engine ? true : terminalColorDepth(stdout) >= 24);

  // Resolve a camera's working framerate once and cache it. Capture cards are mode-locked
  // (e.g. only 1080p60), so we probe their supported modes; null means it wouldn't open.
  function resolveCameraFps(index) {
    const cache = cameraFpsRef.current;
    if (cache.has(index)) return cache.get(index);
    const modes = engine ? [{ minFps: 60, maxFps: 60 }] : probeVideoModes(index, ffmpegPath);
    const val = modes.length ? pickFramerate(modes, fps) : null;
    cache.set(index, val);
    return val;
  }

  // The recording gain that honors the macOS input-volume slider (which avfoundation
  // capture otherwise ignores). Resolved on the review step and reused when recording.
  const [micGain, setMicGain] = useState(null);
  function resolveGain() {
    if (micIdx == null) return 1;
    const name = (audio.find((a) => a.index === micIdx) || {}).name;
    if (engine) return config.audioGain != null ? config.audioGain : 1;
    return resolveMicGain({
      micName: name,
      override: config.audioGain,
      volume: macInputVolume(),
      defaultName: defaultInputName(),
    });
  }
  // Resolve the input gain once on the review step (reads the macOS slider via osascript).
  useEffect(() => {
    if (phase === 'wizard' && step === 3 && micIdx != null) setMicGain(resolveGain());
  }, [phase, step, micIdx]);

  // live recording state
  const [, setFrame] = useState(0);
  const levelsRef = useRef([]);
  const rmsRef = useRef(0);
  const statsRef = useRef(new Map());
  const statusRef = useRef(new Map()); // label -> {state, msg}
  const recorderRef = useRef(null);
  const planRef = useRef(null);
  const startRef = useRef(0);

  // Live mic meter shown during the wizard so you can confirm the mic works before recording.
  const micMeterRef = useRef([]);
  const micRmsRef = useRef(0);
  useEffect(() => {
    const active = phase === 'wizard' && (step === 0 || step === 3) && micIdx != null;
    if (!active) return;
    micMeterRef.current = [];
    micRmsRef.current = 0;
    const push = (unit, rms) => {
      const a = micMeterRef.current;
      a.push(unit);
      if (a.length > 40) a.splice(0, a.length - 40);
      micRmsRef.current = rms;
    };
    let stop;
    if (engine) {
      // demo / tests: synthesize a lifelike level so the meter animates without ffmpeg
      let t = 0;
      const id = setInterval(() => {
        t += 0.08;
        const v = Math.min(1, Math.abs(Math.sin(t * 2)) * 0.55 + 0.05 * Math.abs(Math.sin(t * 31)));
        push(v, v);
      }, 80);
      stop = () => clearInterval(id);
    } else {
      const kill = startMicTap({
        ffmpegPath,
        audioIndex: micIdx,
        onLevel: ({ unit, rms }) => push(unit, rms),
      });
      stop = kill;
    }
    const tick = setInterval(() => setFrame((f) => (f + 1) % 1e9), 90);
    return () => {
      stop && stop();
      clearInterval(tick);
      micMeterRef.current = [];
    };
  }, [phase, step, micIdx, engine, ffmpegPath]);

  // Grab a thumbnail of each device the first time its picker step (cameras=1, screens=2)
  // is shown. Grabs run STRICTLY sequentially - two concurrent avfoundation SCREEN
  // captures deadlock macOS (the invariant in recorder.js). Results stream in so previews
  // appear one by one; failures fall back to a placeholder, never blocking selection.
  useEffect(() => {
    const list =
      phase === 'wizard' && step === 1
        ? cameras
        : phase === 'wizard' && step === 2
          ? screens
          : null;
    if (!list || !canThumb) return;
    const pending = list.filter((d) => !thumbsStartedRef.current.has(d.index));
    if (!pending.length) return;
    for (const d of pending) thumbsStartedRef.current.add(d.index);
    setThumbs((prev) => {
      const m = new Map(prev);
      for (const d of pending) m.set(d.index, { status: 'loading' });
      return m;
    });

    if (engine) {
      // demo: synthesize instantly, never touches a real device
      setThumbs((prev) => {
        const m = new Map(prev);
        pending.forEach((d, i) =>
          m.set(d.index, {
            status: 'ok',
            lines: syntheticThumbnail(d.index + i, THUMB_W, THUMB_PX_H),
          }),
        );
        return m;
      });
      return;
    }

    (async () => {
      for (const d of pending) {
        if (!aliveRef.current) return;
        // Cameras are mode-locked; grab at a framerate the device supports (null = dead).
        const camFps = d.kind === 'camera' ? resolveCameraFps(d.index) : null;
        const t =
          d.kind === 'camera' && camFps == null
            ? null
            : await grabScreenThumbnail({
                ffmpegPath,
                videoIndex: d.index,
                width: THUMB_W,
                height: THUMB_PX_H,
                fps: camFps ?? fps,
              });
        if (!aliveRef.current) return;
        setThumbs((prev) => {
          const m = new Map(prev);
          m.set(d.index, t ? { status: 'ok', lines: t.lines } : { status: 'fail' });
          return m;
        });
      }
    })();
  }, [phase, step, canThumb, engine, ffmpegPath]);

  const nameOfVideo = (idx) =>
    (devices.video.find((d) => d.index === idx) || {}).name || `video ${idx}`;

  function buildSelectedSources() {
    const src = [];
    for (const idx of scrSel)
      src.push({ type: 'screen', deviceIndex: idx, deviceName: nameOfVideo(idx) });
    for (const idx of camSel)
      src.push({ type: 'camera', deviceIndex: idx, deviceName: nameOfVideo(idx) });
    return src;
  }

  function openDir() {
    const dir = planRef.current && planRef.current.dir;
    if (!dir) return;
    try {
      spawn('open', [dir], { stdio: 'ignore', detached: true }).unref();
    } catch {
      /* best effort */
    }
  }

  function gotoStep(s) {
    setStep(s);
    if (s === 0) {
      const i = audio.findIndex((a) => a.index === micIdx);
      setCursor(i < 0 ? 0 : i);
    } else {
      setCursor(0);
    }
  }

  // ---- recording lifecycle ----
  function startRecording() {
    const selectedSources = buildSelectedSources();
    if (selectedSources.length === 0) return;
    // Resolve each camera's framerate from its supported modes (capture cards are
    // mode-locked, e.g. only 1080p60, and reject the global fps).
    for (const s of selectedSources) {
      if (s.type !== 'camera') continue;
      const camFps = resolveCameraFps(s.deviceIndex);
      if (camFps != null) s.fps = camFps;
    }
    const mic =
      micIdx == null
        ? null
        : { index: micIdx, name: (audio.find((a) => a.index === micIdx) || {}).name };
    // Honor the macOS input-volume slider (avfoundation capture ignores it).
    if (mic) mic.gain = micGain != null ? micGain : resolveGain();
    const cfg = { ...config, remuxToMp4: mp4, video: { ...config.video, fps } };
    let plan;
    try {
      plan = buildPlan({ title, selectedSources, mic, config: cfg, date: new Date() });
      ensurePlanDirs(plan);
      fs.writeFileSync(path.join(plan.dir, 'notes.md'), buildNotesMarkdown(plan));
    } catch (e) {
      setError(e.message);
      setPhase('error');
      return;
    }
    planRef.current = plan;
    for (const s of plan.sources) statusRef.current.set(s.label, { state: 'recording' });
    if (plan.audio) statusRef.current.set('audio', { state: 'recording' });

    const rec = (engine || new FfmpegEngine({ ffmpegPath })).createRecording(plan);
    recorderRef.current = rec;
    rec.on('level', ({ unit, rms }) => {
      const arr = levelsRef.current;
      arr.push(unit);
      if (arr.length > waveWidth + 4) arr.splice(0, arr.length - (waveWidth + 4));
      rmsRef.current = rms ?? unit;
    });
    rec.on('stats', ({ label, stats }) => statsRef.current.set(label, stats));
    rec.on('source-error', ({ label, error: err }) => {
      statusRef.current.set(label, { state: 'error', msg: shortErr(err.message) });
    });
    rec.start();
    startRef.current = Date.now();
    setPhase('recording');
  }

  async function stopRecording({ thenExit = false } = {}) {
    if (phase !== 'recording') return;
    setPhase('stopping');
    const rec = recorderRef.current;
    const plan = planRef.current;
    const res = await rec.stop();
    // Anonymous counts only - never titles, device names, or paths.
    try {
      const started = Date.parse(rec.startedAt);
      const ended = Date.parse(rec.endedAt);
      telemetry?.track('record', {
        screens: plan.sources.filter((s) => s.type === 'screen').length,
        cameras: plan.sources.filter((s) => s.type === 'camera').length,
        files: res.length,
        fps: plan.settings.fps,
        mp4: plan.settings.remuxToMp4,
        container: plan.settings.container,
        duration_sec: started && ended ? Math.round((ended - started) / 1000) : null,
      });
    } catch {
      /* telemetry is best-effort */
    }
    try {
      const manifest = buildSessionManifest(plan, {
        startedAt: rec.startedAt,
        endedAt: rec.endedAt,
        results: res.map((r) => ({
          label: r.label,
          bytes: r.bytes,
          seconds: r.seconds,
          mp4: r.mp4,
        })),
      });
      fs.writeFileSync(
        path.join(plan.dir, 'session.json'),
        JSON.stringify(manifest, null, 2) + '\n',
      );
    } catch {
      /* manifest is best-effort */
    }
    if (thenExit) return exit(); // q during recording: finalize, then quit (no summary)
    setResults(res);
    setPhase('done');
  }

  // re-render loop while recording (waveform + stats + timer)
  useEffect(() => {
    if (phase !== 'recording') return;
    const id = setInterval(() => setFrame((f) => (f + 1) % 1e9), 60);
    return () => clearInterval(id);
  }, [phase]);

  // ---- input ----
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (phase === 'recording') return void stopRecording();
      if (phase === 'stopping') return;
      return exit();
    }
    // q always quits. While recording it finalizes first so ffmpeg isn't orphaned.
    if (input === 'q') {
      if (phase === 'recording') return void stopRecording({ thenExit: true });
      if (phase === 'stopping') return;
      return exit();
    }
    if (phase === 'done') {
      if (input === 'o') return openDir();
      if (input === 'q' || key.return || key.escape) exit();
      return;
    }
    if (phase === 'error') {
      if (input === 'q' || key.return || key.escape) exit();
      return;
    }
    if (phase !== 'wizard') return;

    const len =
      step === 0
        ? audio.length
        : step === 1
          ? cameras.length
          : step === 2
            ? screens.length
            : REVIEW_SETTINGS;

    if (key.upArrow || input === 'k') {
      if (!len) return;
      const c = (cursor - 1 + len) % len;
      setCursor(c);
      if (step === 0 && audio[c]) setMicIdx(audio[c].index); // single-select follows the highlight
      return;
    }
    if (key.downArrow || input === 'j') {
      if (!len) return;
      const c = (cursor + 1) % len;
      setCursor(c);
      if (step === 0 && audio[c]) setMicIdx(audio[c].index);
      return;
    }

    if (key.escape) {
      if (step > 0) gotoStep(step - 1);
      else exit();
      return;
    }

    if (step === 0) {
      if (key.return) gotoStep(1); // selection already follows the highlight
      return;
    }
    if (step === 1 || step === 2) {
      const list = step === 1 ? cameras : screens;
      const setSel = step === 1 ? setCamSel : setScrSel;
      if (input === ' ') {
        const item = list[cursor];
        if (item) setSel((prev) => toggle(prev, item.index));
        return;
      }
      if (key.return) return gotoStep(step + 1);
      return;
    }
    if (step === 3) {
      if (key.return) return startRecording();
      // row settings: 0 = frame rate, 1 = mp4 remux. ←/→/space change the focused row.
      if (cursor === 0) {
        if (key.leftArrow) return setFps((v) => prevFps(v));
        if (key.rightArrow || input === ' ') return setFps((v) => nextFps(v));
      } else if (cursor === 1) {
        if (key.leftArrow || key.rightArrow || input === ' ') return setMp4((v) => !v);
      }
      return;
    }
  });

  // ---- render ----
  if (phase === 'wizard') return WizardView();
  if (phase === 'recording' || phase === 'stopping') return DashboardView();
  if (phase === 'done') return SummaryView();
  if (phase === 'error') return ErrorView();
  return null;

  function WizardView() {
    const outDir = planPreviewDir();
    let body;
    if (step === 0) {
      body = audio.length
        ? html`<${Box} flexDirection="column"
            >${listBody(
              audio,
              cursor,
              new Set(micIdx != null ? [micIdx] : []),
              false,
              C.mic,
            )}${micMeterView()}<//
          >`
        : noMicNote();
    } else if (step === 1) {
      body = !cameras.length
        ? noCamerasNote()
        : canThumb
          ? thumbListBody(cameras, camSel, C.camera)
          : listBody(cameras, cursor, camSel, true, C.camera);
    } else if (step === 2) {
      body = !screens.length
        ? noScreensNote()
        : canThumb
          ? thumbListBody(screens, scrSel, C.screen)
          : listBody(screens, cursor, scrSel, true, C.screen);
    } else {
      body = reviewBody();
    }
    const titles = ['Microphone', 'Cameras', 'Screens', 'Review'];
    const accents = [C.mic, C.camera, C.screen, C.ok];
    const baseHints =
      step === 3
        ? [
            ['↑↓', 'move'],
            ['←→/space', 'change'],
            ['enter', 'start'],
            ['esc', 'back'],
          ]
        : step === 0
          ? [
              ['↑↓', 'choose'],
              ['enter', 'next'],
              ['esc', 'back'],
            ]
          : [
              ['↑↓', 'move'],
              ['space', 'select'],
              ['enter', 'next'],
              ['esc', 'back'],
            ];
    const hints = [...baseHints, ['q', 'quit']];
    const frameTitle = html`
      <${Text}>
        <${Text} color=${C.dim}>Step ${step + 1}/4</${Text}>
        <${Text} bold=${true} color=${accents[step]}>  ${titles[step]}</${Text}>
      </${Text}>
    `;
    return html`
      <${Box} flexDirection="column" paddingX=${1} paddingTop=${1}>
        <${Box} flexDirection="column" marginBottom=${1}>
          <${Box}>
            <${Text}>  </${Text}>${wordmark}<${Text} color=${C.dim}>  » ${title}</${Text}>
          <//>
          <${Text} color=${C.dim}>   ${outDir}</${Text}>
        <//>
        ${issuesBanner()}
        <${Frame} title=${frameTitle} status=${stepCountStatus()} statusColor=${C.dim} color=${C.border}>
          ${body}
          <${Box} marginTop=${1}><${StepDots} index=${step} total=${4} /><//>
        <//>
        <${HintBar} hints=${hints} />
      <//>
    `;
  }

  function listBody(items, cur, selSet, multi, accent) {
    const sel = selSet instanceof Set ? selSet : new Set();
    return html`
      <${Box} flexDirection="column">
        ${items.map((d, i) => {
          const selected = sel.has(d.index);
          const focused = i === cur;
          // For multi-select, spell out that the highlight is just the cursor: the
          // focused-but-unselected row invites the space press; selected rows show a check.
          let rowMeta = null;
          if (multi) {
            if (focused && !selected) rowMeta = 'space to select';
            else if (selected) rowMeta = `${G.tick} selected`;
          }
          return html`<${Row}
            key=${d.index}
            focused=${focused}
            selected=${selected}
            multi=${multi}
            label=${d.name}
            meta=${rowMeta}
            accent=${accent}
            width=${contentWidth}
          />`;
        })}
      <//>
    `;
  }

  // A device's preview, or a same-footprint placeholder while it loads / if it failed,
  // so the list never reflows as thumbnails stream in.
  function screenThumbView(idx) {
    const t = thumbs.get(idx);
    if (t && t.status === 'ok') {
      return html`<${Box} flexDirection="column">
        ${t.lines.map((ln, i) => html`<${Text} key=${i}>${ln}</${Text}>`)}
      <//>`;
    }
    const fill = (t && t.status === 'fail' ? '·' : '░').repeat(THUMB_W);
    return html`<${Box} flexDirection="column">
      ${Array.from(
        { length: THUMB_ROWS },
        (_, i) => html`<${Text} key=${i} color=${C.border}>${fill}</${Text}>`,
      )}
    <//>`;
  }

  // Cameras / screens step: each row pairs a live thumbnail with the selectable label,
  // so two identical monitors (or an ambiguous capture card) are told apart by what they
  // actually show.
  function thumbListBody(items, selSet, accent) {
    const labelWidth = Math.max(24, contentWidth - THUMB_W - 2);
    return html`
      <${Box} flexDirection="column">
        ${items.map((d, i) => {
          const selected = selSet.has(d.index);
          const focused = i === cursor;
          const rowMeta =
            focused && !selected ? 'space to select' : selected ? `${G.tick} selected` : null;
          return html`<${Box} key=${d.index} marginBottom=${1}>
            ${screenThumbView(d.index)}
            <${Box} flexDirection="column" justifyContent="center" marginLeft=${1}>
              <${Row}
                focused=${focused}
                selected=${selected}
                multi=${true}
                label=${d.name}
                meta=${rowMeta}
                accent=${accent}
                width=${labelWidth}
              />
            <//>
          <//>`;
        })}
      <//>
    `;
  }

  function reviewBody() {
    const preview = assignLabels(buildSelectedSources());
    const mic = audio.find((a) => a.index === micIdx);
    return html`
      <${Box} flexDirection="column">
        ${
          preview.length === 0
            ? html`<${Text} color=${C.rec}>  ${G.cross} pick at least one screen or camera first (esc)</${Text}>`
            : preview.map(
                (s) =>
                  html`<${Box} key=${s.label} justifyContent="space-between" width=${contentWidth}>
                <${Text} color=${accentForType(s.type)}>${s.deviceName}</${Text}>
                <${Text} color=${C.dim}>${s.label}.${config.video.container}</${Text}>
              <//>`,
              )
        }
        ${
          mic
            ? html`<${Box} justifyContent="space-between" width=${contentWidth}>
                <${Text} color=${C.mic}>${G.film} ${mic.name}</${Text}>
                <${Text} color=${C.dim}>${micGain != null && micGain < 1 ? `${Math.round(micGain * 100)}% · ` : ''}audio.wav</${Text}>
              <//>`
            : null
        }
        <${Box} marginTop=${1}>
          <${Text} color=${C.dim}>${preview.length} video${preview.length === 1 ? '' : 's'}${mic ? ' + audio' : ''} · ${config.video.container}</${Text}>
        <//>
        <${Box} marginTop=${1} flexDirection="column">
          <${SettingRow} focused=${cursor === 0} label="Frame rate" value=${fps + ' fps'} width=${contentWidth} />
          <${SettingRow} focused=${cursor === 1} label="Remux to mp4" value=${mp4 ? 'on' : 'off'} width=${contentWidth} />
        <//>
        ${micMeterView()}
      <//>
    `;
  }

  function issuesBanner() {
    const issues = buildIssues(health, { micSelected: micIdx != null });
    if (!issues.length) return null;
    return html`
      <${Box} flexDirection="column" marginBottom=${1}>
        ${issues.map(
          (it, i) =>
            html`<${Text} key=${i} color=${it.level === 'error' ? C.rec : C.warn}>  ${
              it.level === 'error' ? G.cross : '⚠'
            } ${it.text}</${Text}>`,
        )}
      <//>
    `;
  }

  // Live meter so you can SEE the selected mic responding before you record.
  function micMeterView() {
    if (micIdx == null) return null;
    const vals = micMeterRef.current;
    const recent = vals.slice(-30);
    const maxRecent = recent.length ? Math.max(...recent) : 0;
    const silent = vals.length >= 12 && maxRecent < 0.02;
    return html`
      <${Box} marginTop=${1}>
        <${Waveform} values=${vals} width=${24} height=${1} />
        <${Text} color=${silent ? C.warn : C.dim}>  ${silent ? G.cross + ' no signal - is the mic muted?' : dbfsReadout(micRmsRef.current)}</${Text}>
      <//>
    `;
  }

  function DashboardView() {
    const plan = planRef.current;
    const elapsed = (Date.now() - startRef.current) / 1000;
    const stopping = phase === 'stopping';
    const recColor = stopping ? C.warn : C.rec;
    const blink = Math.floor(Date.now() / 500) % 2 === 0;
    const dbfs = dbfsReadout(rmsRef.current);
    const hot = rmsRef.current > 0.89; // near clipping
    return html`
      <${Box} flexDirection="column" paddingX=${1} paddingTop=${1}>
        <${Frame}
          title=${wordmark}
          status=${`${stopping ? 'finalizing' : blink ? G.rec + ' REC' : '  REC'}  ${fmtDur(elapsed)}`}
          statusColor=${recColor}
          color=${recColor}
        >
          <${Box} flexDirection="column" marginBottom=${1}>
            <${Text} color=${C.dim}>${plan.dirName}</${Text}>
          <//>
          ${plan.sources.map((s) => {
            const st = statsRef.current.get(s.label) || {};
            const status = statusRef.current.get(s.label) || {};
            const failed = status.state === 'error';
            const stalled = !failed && !stopping && elapsed > 4 && !(st.bytes > 0);
            const dot = failed ? C.rec : stalled ? C.warn : C.ok;
            const glyph = failed ? G.cross : stalled ? '◐' : G.dot;
            return html`
              <${Box} key=${s.label} justifyContent="space-between">
                <${Box}>
                  <${Text} color=${dot}>${glyph} </${Text}>
                  <${Text} color=${C.text}>${(s.fileName + '            ').slice(0, 16)}</${Text}>
                <//>
                ${
                  failed
                    ? html`<${Text} color=${C.rec}>${status.msg || 'failed'}</${Text}>`
                    : stalled
                      ? html`<${Text} color=${C.warn}>no frames - is the display awake?</${Text}>`
                      : html`<${Box}>
                        <${Text} color=${C.dim}>${fmtBytes(st.bytes)}   ${st.fps != null ? st.fps.toFixed(0) : '--'} fps   </${Text}>
                        <${Text} color=${st.drop ? C.rec : C.dim} bold=${st.drop ? true : false}>${st.drop ? G.cross + ' ' + st.drop + ' dropped' : '0 drop'}</${Text}>
                      <//>`
                }
              <//>
            `;
          })}
          ${(() => {
            if (!plan.audio) return null;
            const ast = statsRef.current.get('audio') || {};
            const astatus = statusRef.current.get('audio') || {};
            const afailed = astatus.state === 'error';
            return html`<${Box} justifyContent="space-between">
              <${Box}>
                <${Text} color=${afailed ? C.rec : C.ok}>${afailed ? G.cross : G.dot} </${Text}>
                <${Text} color=${C.text}>${'audio.wav        '.slice(0, 16)}</${Text}>
              <//>
              ${
                afailed
                  ? html`<${Text} color=${C.rec}>${astatus.msg || 'failed'}</${Text}>`
                  : html`<${Text} color=${C.dim}>${fmtBytes(ast.bytes)}</${Text}>`
              }
            <//>`;
          })()}
          <${Box} flexDirection="column" marginTop=${1}>
            <${Box} justifyContent="space-between">
              <${Text} color=${C.mic}>${G.film} ${plan.mic ? plan.mic.name : 'no mic'}</${Text}>
              <${Text} color=${hot ? C.rec : C.dim}>${hot ? G.cross + ' ' : ''}${dbfs}</${Text}>
            <//>
            <${Waveform} values=${levelsRef.current} width=${waveWidth} height=${7} />
          <//>
        <//>
        <${HintBar} hints=${
          stopping
            ? [['· · ·', 'finalizing files']]
            : [
                ['Ctrl+C', 'stop'],
                ['q', 'stop & quit'],
              ]
        } />
      <//>
    `;
  }

  function SummaryView() {
    const plan = planRef.current;
    const total = (results || []).reduce((a, r) => a + (r.bytes || 0), 0);
    return html`
      <${Box} flexDirection="column" paddingX=${1} paddingTop=${1}>
        <${Frame} title=${wordmark} status=${`${G.tick} done`} statusColor=${C.ok} color=${C.ok}>
          <${Text} color=${C.ok} bold=${true}>${G.tick} Finalized ${(results || []).length} file${
            (results || []).length === 1 ? '' : 's'
          } (${fmtBytes(total)})</${Text}>
          <${Box} flexDirection="column" marginTop=${1} marginBottom=${1}>
            ${(results || []).map(
              (r) =>
                html`<${Box} key=${r.label} justifyContent="space-between">
                <${Text} color=${C.text}>  ${path.basename(r.mp4 || r.file)}</${Text}>
                <${Text} color=${C.dim}>${fmtBytes(r.bytes)}${r.mp4 ? '  +mp4' : ''}</${Text}>
              <//>`,
            )}
          <//>
          <${Text} color=${C.dim}>${plan.dir}</${Text}>
          <${Box} flexDirection="column" marginTop=${1}>
            <${Text} color=${C.text}>${G.arrow} Sync by audio: import this folder and use your</${Text}>
            <${Text} color=${C.text}>  editor's sync-by-audio to align the clips.</${Text}>
          <//>
        <//>
        <${HintBar} hints=${[
          ['o', 'open folder'],
          ['q', 'quit'],
        ]} />
      <//>
    `;
  }

  function ErrorView() {
    return html`
      <${Box} flexDirection="column" paddingX=${1} paddingTop=${1}>
        <${Frame} title=${wordmark} status=${`${G.cross} error`} statusColor=${C.rec} color=${C.rec}>
          <${Text} color=${C.rec}>${error}</${Text}>
        <//>
        <${HintBar} hints=${[['q', 'quit']]} />
      <//>
    `;
  }

  function planPreviewDir() {
    try {
      const cfg = { ...config, remuxToMp4: mp4 };
      const p = buildPlan({
        title,
        selectedSources: buildSelectedSources(),
        mic: null,
        config: cfg,
        date: new Date(),
        existsFn: () => false,
      });
      return p.dir;
    } catch {
      return config.recordingsDir;
    }
  }

  function stepCountStatus() {
    if (step === 1) return `${camSel.size} selected`;
    if (step === 2) return `${scrSel.size} selected`;
    return '';
  }
}

function guide(title, lines) {
  return html`
    <${Box} flexDirection="column">
      <${Text} color=${C.warn}>  ${title}</${Text}>
      ${lines.map((l, i) => html`<${Text} key=${i} color=${C.dim}>  ${l}</${Text}>`)}
    <//>
  `;
}
const noScreensNote = () =>
  guide('No screens detected.', [
    '- Unlock and wake the display - a locked screen is not capturable.',
    '- Grant Screen Recording: System Settings > Privacy & Security >',
    '  Screen Recording > enable your terminal, then restart it.',
  ]);
const noCamerasNote = () =>
  guide('No cameras / capture cards detected.', [
    '- Plug one in and power it on, or check it has a live signal.',
    '- Grant Camera access in System Settings > Privacy & Security.',
  ]);
const noMicNote = () =>
  guide('No microphones detected.', [
    '- Connect a mic - without one, clips have no audio sync track.',
    '- Grant Microphone access in System Settings > Privacy & Security.',
  ]);
// Screen-preview thumbnail grid. Width in terminal cells; height in *pixels* (two
// pixels stack into one half-block cell, so 12px -> 6 rendered rows).
const THUMB_W = 24;
const THUMB_PX_H = 12;
const THUMB_ROWS = THUMB_PX_H / 2;

// Half-block thumbnails need 24-bit color; degrade to plain labels otherwise.
function terminalColorDepth(stdout) {
  try {
    if (stdout && typeof stdout.getColorDepth === 'function') return stdout.getColorDepth();
  } catch {
    /* not a tty */
  }
  return 0;
}

const REVIEW_SETTINGS = 2; // frame rate, mp4 remux
const FPS_OPTIONS = [24, 30, 48, 60];
function nextFps(v) {
  const i = FPS_OPTIONS.indexOf(v);
  return i === -1 ? 30 : FPS_OPTIONS[(i + 1) % FPS_OPTIONS.length];
}
function prevFps(v) {
  const i = FPS_OPTIONS.indexOf(v);
  return i === -1 ? 30 : FPS_OPTIONS[(i - 1 + FPS_OPTIONS.length) % FPS_OPTIONS.length];
}
function toggle(prevSet, idx) {
  const next = new Set(prevSet);
  if (next.has(idx)) next.delete(idx);
  else next.add(idx);
  return next;
}
function shortErr(msg) {
  const m = String(msg || '').toLowerCase();
  if (m.includes('i/o error') || m.includes('input/output')) return 'no signal / busy';
  if (m.includes('permission')) return 'permission denied';
  return String(msg || 'failed')
    .split('\n')[0]
    .slice(0, 28);
}
function dbfsReadout(rms) {
  if (!rms || rms <= 0) return '-∞ dBFS';
  const db = Math.round(toDbfs(rms) * 10) / 10;
  return `${db > 0 ? '+' : ''}${db} dBFS`;
}
