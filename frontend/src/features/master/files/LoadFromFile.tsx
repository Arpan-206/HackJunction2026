import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type Bundle, type ImportReport } from '../../../api';
import { Button } from '../../../components/ui';
import { downloadBundle, importSummary, parseBundle } from './bundleFiles';
import './files.css';

/**
 * "Load from file" on the expert's studio: pick a `.geppetto.json`, load it (POST /api/lessons/import) and say what came
 * in. A lesson or take that differs from the copy here is kept and named; "Replace mine" loads the file's copy over it.
 * "Back up everything" saves one file with every lesson, take, calibration and draft (videos listed, not included).
 */
export function LoadFromFile({ onLoaded }: { onLoaded?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (b: Bundle, overwrite: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setReport(await api.importBundle(b, overwrite));
      setBundle(b);
      onLoaded?.();
    } catch (e) {
      setError(`Not loaded: ${e instanceof ApiError ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setReport(null);
    try {
      await load(parseBundle(await file.text()), false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    if (input.current) input.current.value = '';
  };

  const backup = async () => {
    setBusy(true);
    setError(null);
    try {
      downloadBundle(await api.exportAll(), `geppetto-backup-${new Date().toISOString().slice(0, 10)}`);
    } catch (e) {
      setError(`Backup not saved: ${e instanceof ApiError ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const lessonTitle = (id: string) => bundle?.lessons.find((l) => l.id === id)?.title ?? id;

  return (
    <div className="xf-files">
      <div className="xf-files__row">
        <Button variant="secondary" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? 'Loading...' : 'Load from file'}
        </Button>
        <Button variant="ghost" onClick={() => void backup()} disabled={busy}>
          Back up everything
        </Button>
        <input
          ref={input}
          className="xf-hidden-input"
          type="file"
          accept=".json,application/json"
          aria-label="Choose a Geppetto file to load"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </div>
      {error && (
        <p className="xf-files__msg" role="alert">
          {error}
        </p>
      )}
      {report && (
        <div className="xf-files" role="status">
          {importSummary(report).map((line) => (
            <p key={line} className="xf-files__msg">
              {line}
            </p>
          ))}
          {report.lesson_ids.length > 0 && (
            <ul className="xf-files__list">
              {report.lesson_ids.map((id) => (
                <li key={id}>
                  <Link to={`/expert/lessons/${id}`}>{lessonTitle(id)}</Link>
                </li>
              ))}
            </ul>
          )}
          {report.conflicts.length > 0 && bundle && (
            <Button variant="secondary" onClick={() => void load(bundle, true)} disabled={busy}>
              Replace mine
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
