// Artifacts written alongside the footage: a machine-readable manifest and a
// human sync recipe.

export function buildSessionManifest(plan, { startedAt, endedAt, results = [] } = {}) {
  return {
    tool: 'justroll',
    title: plan.title,
    dir: plan.dir,
    startedAt: startedAt ?? null,
    endedAt: endedAt ?? null,
    mic: plan.mic ? plan.mic.name : null,
    settings: plan.settings,
    sources: plan.sources.map((s) => {
      const r = results.find((x) => x.label === s.label) || {};
      return {
        label: s.label,
        type: s.type,
        device: s.deviceName,
        file: s.fileName,
        mp4: r.mp4 || null,
        bytes: r.bytes ?? null,
        durationSec: r.seconds ?? null,
      };
    }),
  };
}

export function buildNotesMarkdown(plan) {
  const lines = [];
  lines.push(`# ${plan.title}`, '');
  lines.push(
    'Recorded with **justroll**. Every clip carries the same mic track, so any editor',
    'that can sync clips by audio will line them up automatically.',
    '',
  );
  lines.push('## Sync by audio', '');
  lines.push('1. Import this folder into your video editor.');
  lines.push('2. Select all the clips in `raw/` (or the `.mp4` exports).');
  lines.push("3. Use your editor's sync-by-audio feature to align them.", '');
  lines.push('## Sources', '');
  for (const s of plan.sources) {
    lines.push(`- \`${s.fileName}\` - ${s.deviceName} (${s.type})`);
  }
  lines.push('');
  if (plan.mic) lines.push(`Mic: **${plan.mic.name}**`, '');
  lines.push(
    `Settings: ${plan.settings.fps}fps - ${plan.settings.codec} - ${plan.settings.container}` +
      (plan.settings.remuxToMp4 ? ' (+mp4)' : ''),
    '',
  );
  return lines.join('\n');
}
