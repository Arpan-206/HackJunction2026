import './files.css';

/** True while the app answers from the in-browser sample backend (mock mode), so nothing reaches backend/data. */
export function isSampleData(): boolean {
  return typeof window !== 'undefined' && window.__apprenticeMock === true;
}

export const SAMPLE_DATA_NOTICE = 'Sample data mode: takes are not saved to disk. Start the backend to keep them.';

/** A plain line on the expert's recording screens in mock mode, so nobody believes their takes are kept. */
export function SampleDataNotice() {
  if (!isSampleData()) return null;
  return (
    <p className="xf-plain" role="note">
      {SAMPLE_DATA_NOTICE}
    </p>
  );
}
