import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useDevState, useGloveStream, type GloveSource, type LlmProvider, type MotionSpec } from '../api';
import { THEMES, THEME_IDS, useTheme, type ThemeId } from '../theme';
import { setSettings, useSettings, type GuidanceMode } from '../state/settings';
import { isDev } from '../features/apprentice/pipeline/flags';
import { clearPracticeHistory, resetDemoHistory } from '../features/apprentice/pipeline/demoHistory';
import { isKiosk } from '../features/shared/kiosk';
import './devPanel.css';

/** The old, sticky localStorage flag. It is cleared on sight so a dev panel switched on long ago never resurfaces. */
const LEGACY_KEY = 'apprentice.devpanel';

const MOTIONS: Record<string, MotionSpec> = {
  finger_sequence: { preset: 'finger_sequence', sequence: [1, 2, 3, 4, 5], beat_ms: 620 },
  grip_and_swing: { preset: 'grip_and_swing', grip: 'shakehand', swing: 'forehand', beat_ms: 1500 },
  pinch: { preset: 'pinch', fingers: [2, 3], beat_ms: 900 },
  hold_pose: { preset: 'hold_pose', pose: { thumb: 0.5, index: 0.6, middle: 0.6, ring: 0.6, little: 0.6 } },
  idle: { preset: 'idle' },
};

/** The free camera stage of the role select hand (src/dev/HandCameraView.tsx). */
const HAND_CAMERA_PATH = '/dev/hand-camera';

/**
 * The panel sits outside the router, so move in-app through the history API (the router listens for popstate). A
 * modified click (new tab or window) is left to the browser. True when it navigated here, so the panel can fold away.
 */
function openHandCamera(e: MouseEvent<HTMLAnchorElement>): boolean {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  e.preventDefault();
  window.history.pushState({}, '', HAND_CAMERA_PATH);
  window.dispatchEvent(new PopStateEvent('popstate'));
  return true;
}

/** Shown only once the URL has carried ?dev=1 in this tab (sessionStorage, cleared by ?dev=0 or by closing the tab). */
function shouldShow(): boolean {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* storage unavailable */
  }
  // A kiosk never shows the dev panel, whatever the URL says: a visitor could type ?dev=1.
  return isDev() && !isKiosk();
}

/**
 * Floating developer panel (backend switches, smoothing, theme, guidance default). Renders only with ?dev=1.
 * Delete this import and the <DevPanel /> in main.tsx before the demo.
 */
export function DevPanel() {
  const [visible] = useState(shouldShow);
  const [open, setOpen] = useState(false);
  if (!visible) return null;
  return (
    <aside className="dev" aria-label="Developer panel">
      {open && <Body onLeave={() => setOpen(false)} />}
      <button type="button" className="dev__toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Close' : 'Dev'}
      </button>
    </aside>
  );
}

function Body({ onLeave }: { onLeave: () => void }) {
  const { state, error, online, update } = useDevState();
  const glove = useGloveStream(true);
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [cut, setCut] = useState(1);
  const [beta, setBeta] = useState(0.02);

  useEffect(() => {
    if (state) {
      setCut(state.smoothing.min_cutoff);
      setBeta(state.smoothing.beta);
    }
  }, [state?.smoothing.min_cutoff, state?.smoothing.beta]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = (patch: Parameters<typeof update>[0]) => {
    update(patch).then(() => setMsg(null), (e: Error) => setMsg(e.message));
  };
  const debounced = (patch: Parameters<typeof update>[0]) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => send(patch), 250);
  };

  const motionKey = state ? (Object.keys(MOTIONS).find((k) => MOTIONS[k].preset === state.simulator_motion.preset) ?? 'idle') : 'idle';

  return (
    <div className="dev__body">
      <a
        className="dev__link"
        href={HAND_CAMERA_PATH}
        onClick={(e) => {
          if (openHandCamera(e)) onLeave();
        }}
      >
        Hand camera view
      </a>
      <p className="dev__status">
        <span className={`dev__dot ${online ? 'dev__dot--ok' : ''}`} />
        Backend {online ? 'online' : error ? 'offline' : 'checking'}
        <span className="dev__sep" />
        <span className={`dev__dot ${glove.status === 'open' ? 'dev__dot--ok' : ''}`} />
        Gloves WS {glove.status}
      </p>
      {msg && <p className="dev__err">{msg}</p>}

      <label>
        Glove source
        <select disabled={!state} value={state?.glove_source ?? ''} onChange={(e) => send({ glove_source: e.target.value as GloveSource })}>
          {!state && <option value="">unknown</option>}
          <option value="simulator">simulator</option>
          <option value="rokoko_udp">rokoko_udp</option>
          <option value="rokoko_sdk">rokoko_sdk</option>
          <option value="external">external</option>
        </select>
      </label>

      <label>
        Simulator motion
        <select
          disabled={!state}
          value={motionKey}
          onChange={(e) => {
            send({ simulator_motion: MOTIONS[e.target.value] });
            glove.setMotion(MOTIONS[e.target.value]);
          }}
        >
          {Object.keys(MOTIONS).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>

      <fieldset disabled={!state}>
        <legend>Smoothing (One Euro)</legend>
        <label className="dev__row">
          <input type="checkbox" checked={state?.smoothing.enabled ?? false} onChange={(e) => send({ smoothing: { enabled: e.target.checked } })} />
          Enabled
        </label>
        <label>
          min_cutoff {cut.toFixed(2)}
          <input
            type="range"
            min="0.05"
            max="10"
            step="0.05"
            value={cut}
            onChange={(e) => {
              setCut(Number(e.target.value));
              debounced({ smoothing: { min_cutoff: Number(e.target.value) } });
            }}
          />
        </label>
        <label>
          beta {beta.toFixed(3)}
          <input
            type="range"
            min="0"
            max="0.2"
            step="0.001"
            value={beta}
            onChange={(e) => {
              setBeta(Number(e.target.value));
              debounced({ smoothing: { beta: Number(e.target.value) } });
            }}
          />
        </label>
      </fieldset>

      <label>
        LLM provider
        <select disabled={!state} value={state?.llm_provider ?? ''} onChange={(e) => send({ llm_provider: e.target.value as LlmProvider })}>
          {!state && <option value="">unknown</option>}
          <option value="fake">fake</option>
          <option value="gemini">gemini</option>
          <option value="openai">openai (Gemma on Verda)</option>
        </select>
      </label>
      {state?.llm_chain && state.llm_chain.length > 0 && (
        <p>
          Chain: {state.llm_chain.join(' then ')}. Last answer: {state.llm_answered_by ?? 'none yet'}.
        </p>
      )}

      <label>
        Theme
        <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeId)}>
          {THEME_IDS.map((id) => (
            <option key={id} value={id}>
              {THEMES[id].label}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>Practice history (this device)</legend>
        <button type="button" onClick={resetDemoHistory} title="Clears attempts and tests; the learner dashboard seeds a 3-day streak ending today">
          Fresh demo history
        </button>
        <button type="button" onClick={clearPracticeHistory} title="Clears attempts and tests and keeps them empty (no demo seeding)">
          Empty history
        </button>
      </fieldset>

      <label>
        Apprentice guidance default
        <select value={settings.guidanceMode} onChange={(e) => setSettings({ guidanceMode: e.target.value as GuidanceMode })}>
          <option value="ghost">ghost</option>
          <option value="shadow">shadow</option>
          <option value="side_by_side">side by side</option>
        </select>
      </label>
    </div>
  );
}
