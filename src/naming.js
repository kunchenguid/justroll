// Pure helpers for turning a human title into safe, predictable filesystem names.

export function slugify(title) {
  const slug = String(title ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

export function dateStamp(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function sessionDirName(title, date = new Date()) {
  return `${dateStamp(date)}_${slugify(title)}`;
}

// Append -2, -3 ... until `exists(name)` returns false.
export function uniqueDirName(name, exists) {
  if (!exists(name)) return name;
  let i = 2;
  while (exists(`${name}-${i}`)) i++;
  return `${name}-${i}`;
}

// Give every selected source a stable label: screen-0, screen-1, camera (or camera-0 when >1).
export function assignLabels(sources) {
  let screenN = 0;
  let camN = 0;
  const camCount = sources.filter((s) => s.type === 'camera').length;
  return sources.map((s) => {
    if (s.type === 'screen') return { ...s, label: `screen-${screenN++}` };
    if (s.type === 'camera') return { ...s, label: camCount > 1 ? `camera-${camN++}` : 'camera' };
    return { ...s, label: `source-${s.deviceIndex}` };
  });
}

export function fileName(label, container = 'mkv') {
  return `${label}.${container}`;
}
