import { useState } from 'react';
import { api, ApiError, type FileKind } from '../../../api';
import { isDev } from '../../apprentice/pipeline/flags';
import { isSampleData } from './SampleDataNotice';
import './files.css';

export const SAMPLE_NO_FILE = 'Sample data: no file on disk.';

interface RevealFileProps {
  kind: FileKind;
  id: string;
  /** What the file is, for screen readers: "take 2", "this lesson", "the reference take of step 1". */
  what?: string;
  className?: string;
}

/** A failed reveal in plain words. */
function failure(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 404) return 'No file on disk for this yet.';
    if (e.status === 403) return 'The backend has the file reveal switched off, or this page is not on the backend machine.';
    if (e.isNetwork) return 'The backend could not be reached.';
    return e.message;
  }
  return String(e);
}

/**
 * Dev only (`?dev=1`): "Open file location" opens Explorer (or Finder) on the backend machine with the stored file
 * selected, and "Copy path" copies its absolute path, so a take or lesson can be sent on. Hidden without dev mode.
 */
export function RevealFile({ kind, id, what, className }: RevealFileProps) {
  const [msg, setMsg] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!isDev() || !id) return null;
  const about = what ? ` of ${what}` : '';

  const run = async (copy: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      const loc = copy ? await api.locateFile(kind, id) : await api.revealFile(kind, id);
      if (isSampleData() || loc.path.startsWith('mock://')) {
        setPath(null);
        setMsg(SAMPLE_NO_FILE);
        return;
      }
      setPath(loc.path);
      if (copy) {
        try {
          await navigator.clipboard.writeText(loc.path);
          setMsg('Copied.');
        } catch {
          setMsg('Could not copy; select the path below.');
        }
      } else {
        setMsg(loc.opened ? 'Opened in the file manager.' : 'No file manager could be opened; the path is below.');
      }
    } catch (e) {
      setPath(null);
      setMsg(failure(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`xf-reveal${className ? ` ${className}` : ''}`}>
      <span className="xf-reveal__acts">
        <button type="button" className="xf-reveal__btn" disabled={busy} onClick={() => void run(false)} aria-label={`Open file location${about}`}>
          Open file location
        </button>
        <button type="button" className="xf-reveal__btn" disabled={busy} onClick={() => void run(true)} aria-label={`Copy path${about}`}>
          Copy path
        </button>
        {msg && (
          <span className="xf-reveal__msg" role="status">
            {msg}
          </span>
        )}
      </span>
      {path && <code className="xf-reveal__path">{path}</code>}
    </div>
  );
}
