import { useState } from 'react';
import { api, ApiError } from '../../../api';
import { Button } from '../../../components/ui';
import { downloadBundle } from './bundleFiles';
import { isSampleData } from './SampleDataNotice';
import './files.css';

/**
 * "Save to file": downloads the lesson (or every lesson of a skill) as one `.geppetto.json` with every take, the takes
 * model of each step, the calibrations in use when they were recorded and small videos, so it can be loaded on any
 * Geppetto with "Load from file".
 */
export function SaveToFile({ lessonIds, name, label = 'Save to file' }: { lessonIds: string[]; name: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const bundle = lessonIds.length === 1 ? await api.exportLesson(lessonIds[0]) : await api.exportLessons(lessonIds, name);
      const file = downloadBundle(bundle, name);
      const takes = bundle.recordings.length;
      setMsg(`Saved ${file}: ${bundle.lessons.length === 1 ? 'the lesson' : `${bundle.lessons.length} lessons`} with ${takes} ${takes === 1 ? 'take' : 'takes'}.${isSampleData() ? ' Sample data mode: this file holds sample takes.' : ''}`);
    } catch (e) {
      setMsg(`Not saved: ${e instanceof ApiError ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="xf-files">
      <Button variant="secondary" onClick={() => void save()} disabled={busy || !lessonIds.length}>
        {busy ? 'Saving...' : label}
      </Button>
      {msg && (
        <p className="xf-files__msg" role="status">
          {msg}
        </p>
      )}
    </div>
  );
}
