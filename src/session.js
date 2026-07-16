// Artifacts written alongside the footage: a machine-readable manifest and a
// human sync recipe.

export function buildSessionManifest(plan, { startedAt, endedAt, results = [] } = {}) {
  const byLabel = (label) => results.find((x) => x.label === label) || {};
  const a = plan.audio ? byLabel('audio') : null;
  return {
    tool: 'justroll',
    title: plan.title,
    dir: plan.dir,
    startedAt: startedAt ?? null,
    endedAt: endedAt ?? null,
    mic: plan.mic ? plan.mic.name : null,
    settings: plan.settings,
    // The mic in its own isolated file; startOffsetMs places it on the editor timeline.
    audio: plan.audio
      ? {
          file: plan.audio.fileName,
          device: plan.mic ? plan.mic.name : null,
          gain: plan.audio.gain ?? 1, // applied macOS input-volume (1 = full)
          bytes: a.bytes ?? null,
          durationSec: a.seconds ?? null,
          startOffsetMs: a.startOffsetMs ?? null,
          // Leading silence we added to absorb the mic's warmup so it drops in at 0.
          paddedMs: a.paddedMs ?? 0,
        }
      : null,
    sources: plan.sources.map((s) => {
      const r = byLabel(s.label);
      return {
        label: s.label,
        type: s.type,
        device: s.deviceName,
        file: s.fileName,
        mp4: r.mp4 || null,
        bytes: r.bytes ?? null,
        durationSec: r.seconds ?? null,
        // Milliseconds after the earliest-starting file; place the clip here to align.
        startOffsetMs: r.startOffsetMs ?? null,
      };
    }),
  };
}

export function buildNotesMarkdown(plan) {
  const lines = [];
  lines.push(`# ${plan.title}`, '');
  lines.push(
    'Recorded with **justroll**. Each source is its own clean file - video has no audio',
    'muxed in, and the mic is recorded separately - so nothing competes while capturing.',
    '',
  );
  lines.push('## Sync', '');
  lines.push('Drop every clip from `raw/` (and the audio) at the project start (`00:00`).');
  if (plan.audio) {
    lines.push(
      `\`${plan.audio.fileName}\` is pre-padded with leading silence to absorb the mic's`,
      'warmup, so it lines up with the video without nudging.',
    );
  }
  lines.push(
    '',
    'Exact per-file start offsets are in `session.json` under each `startOffsetMs` (ms after',
    'the earliest clip) - the screens share a clock so they match; nudge a clip if you want',
    'it frame-perfect.',
    '',
  );
  lines.push('## Sources', '');
  for (const s of plan.sources) {
    lines.push(`- \`${s.fileName}\` - ${s.deviceName} (${s.type}, video)`);
  }
  if (plan.audio) lines.push(`- \`${plan.audio.fileName}\` - ${plan.mic.name} (audio)`);
  lines.push('');
  if (plan.mic) lines.push(`Mic: **${plan.mic.name}**`, '');
  lines.push(
    `Settings: ${plan.settings.fps}fps - ${plan.settings.codec} - ${plan.settings.container}` +
      (plan.settings.remuxToMp4 ? ' (+mp4)' : ''),
    '',
  );
  return lines.join('\n');
}
