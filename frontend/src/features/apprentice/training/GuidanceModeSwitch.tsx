import { GUIDANCE_OPTIONS, setGuidance, useGuidance } from '../hooks/useGuidanceMode';
import { Segmented } from './Segmented';

/** Switches the way the master is shown, live, so the team can compare the four guidance versions side by side in a demo. */
export function GuidanceModeSwitch() {
  const mode = useGuidance();
  const current = GUIDANCE_OPTIONS.find((o) => o.id === mode);
  return (
    <div className="ap-field">
      <span className="ap-field__label" id="ap-guidance-label">
        How the master is shown
      </span>
      <Segmented label="Guidance mode" value={mode} options={GUIDANCE_OPTIONS} onChange={setGuidance} grid />
      <p className="note ap-field__hint">{current?.hint}</p>
    </div>
  );
}
