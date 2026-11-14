import { BUNDLE_FILE_SUFFIX, BUNDLE_FORMAT, BUNDLE_FORMAT_VERSION, type Bundle, type ImportItemKind, type ImportReport } from '../../../api';

/** EXPORT_SLUG_MAX_CHARS in backend/app/constants.py. */
const SLUG_MAX = 48;

/** A file-safe lower-case name, as the backend makes it (services/bundles.py, slug). */
export function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
  return s || 'lesson';
}

/** `<skill-name>.geppetto.json`. */
export const bundleFilename = (name: string): string => `${slug(name)}${BUNDLE_FILE_SUFFIX}`;

/** Hands the bundle to the browser as a file download. */
export function downloadBundle(bundle: Bundle, name = bundle.name): string {
  const filename = bundleFilename(name);
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

/** The bundle in a chosen file, or an Error in plain words when it is not one this Geppetto can read. */
export function parseBundle(text: string): Bundle {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not a Geppetto file (it is not JSON).');
  }
  const b = raw as Partial<Bundle> | null;
  if (!b || typeof b !== 'object' || b.format !== BUNDLE_FORMAT) throw new Error('That file is not a Geppetto file.');
  if ((b.format_version ?? 0) > BUNDLE_FORMAT_VERSION) throw new Error('That file was saved by a newer Geppetto. Update this one, then load it again.');
  return {
    kind: 'lessons',
    name: '',
    exported_at: '',
    lessons: [],
    recordings: [],
    takes_models: [],
    calibrations: [],
    wearer_calibrations: [],
    media: [],
    drafts: [],
    warnings: [],
    ...b,
  } as Bundle;
}

const KIND_WORD: Record<ImportItemKind, [string, string]> = {
  lesson: ['lesson', 'lessons'],
  recording: ['take', 'takes'],
  calibration: ['calibration', 'calibrations'],
  wearer_calibration: ['glove calibration', 'glove calibrations'],
  media: ['video', 'videos'],
  draft: ['draft', 'drafts'],
};

function counted(items: { kind: ImportItemKind }[]): string {
  const by = new Map<ImportItemKind, number>();
  for (const i of items) by.set(i.kind, (by.get(i.kind) ?? 0) + 1);
  return [...by.entries()].map(([k, n]) => `${n} ${KIND_WORD[k][n === 1 ? 0 : 1]}`).join(', ');
}

/** The import report in plain sentences: what came in, what was already here, and what was kept because it differs. */
export function importSummary(report: ImportReport): string[] {
  const lines: string[] = [];
  if (report.created.length) lines.push(`Added ${counted(report.created)}.`);
  if (report.overwritten.length) lines.push(`Replaced ${counted(report.overwritten)}.`);
  if (report.unchanged.length) lines.push(`Already here: ${counted(report.unchanged)}.`);
  if (report.conflicts.length) lines.push(`Kept your copy of ${counted(report.conflicts)}: it differs from the file. Load it again with "Replace mine" to use the file's copy.`);
  if (!lines.length) lines.push('The file held nothing to load.');
  return lines;
}
