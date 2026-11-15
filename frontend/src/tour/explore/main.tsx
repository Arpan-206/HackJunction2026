import { installNetGuard } from '../netGuard';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Link, useLocation } from 'react-router-dom';
import '@fontsource/cinzel/500.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/eb-garamond/400-italic.css';
import '@fontsource/eb-garamond/500-italic.css';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/500.css';
import '@fontsource/alegreya-sans/700.css';
import '../../theme/theme.css';
import '../../styles/global.css';
import '../../app/app.css';
import './explore.css';
import { ThemeProvider } from '../../theme';
import { ToastProvider } from '../../components/ui';

/**
 * Explore mode of the public tour: the whole Geppetto app in the browser, after the guided tour. The app's own mock
 * backend (src/mock) answers every /api call and the /ws/gloves and /ws/robot sockets; the "No gloves" mode gives
 * simulated hands. The network guard goes in first, so nothing can leave the page's origin.
 */
installNetGuard();
try {
  window.localStorage.setItem('apprentice.noGloves', '1');
  window.localStorage.setItem('apprentice.mock', '1');
} catch {
  /* storage blocked: the mock still installs from the build flag */
}

/** Screens that need hardware: a plain line instead of a screen that cannot work in a browser alone. */
const NEEDS_HARDWARE: { prefix: string; why: string }[] = [
  { prefix: '/gloves/calibrate', why: 'Calibration measures your own hands in the Rokoko gloves, so it needs the gloves.' },
  { prefix: '/gloves', why: 'This screen shows the Rokoko gloves connected to this computer. In this demo there are no gloves, only simulated hands.' },
  { prefix: '/dev/hand-camera', why: 'This screen reads the phone depth camera on our demo table. It cannot work in a browser alone.' },
  { prefix: '/dev/glove-compare', why: 'This screen compares two live glove streams. It needs the gloves.' },
];

function Badge() {
  return (
    <div className="ex-badge" role="note">
      <p>
        <strong>Demo without gloves: simulated hands.</strong> The live version uses Rokoko gloves. Scores here come from the in-browser scorer on simulated hands. Any
        AI Assistant text here is example text, not written live.
      </p>
      <a href="./">Back to the guided tour</a>
    </div>
  );
}

function Explore({ App }: { App: () => JSX.Element }) {
  const { pathname } = useLocation();
  const blocked = NEEDS_HARDWARE.find((n) => pathname.startsWith(n.prefix));
  return (
    <>
      <Badge />
      {blocked ? (
        <main className="ex-blocked">
          <h1>Not in this demo</h1>
          <p>{blocked.why}</p>
          <p>
            <Link to="/apprentice">Go to the learner's dashboard</Link>
          </p>
        </main>
      ) : (
        <App />
      )}
    </>
  );
}

void import('../../mock/install')
  .then((m) => m.maybeInstallMock())
  .catch(() => false)
  .then(() => import('../../app/App'))
  .then(({ App }) =>
    createRoot(document.getElementById('root') as HTMLElement).render(
      <StrictMode>
        <ThemeProvider>
          <ToastProvider>
            <HashRouter>
              <Explore App={App} />
            </HashRouter>
          </ToastProvider>
        </ThemeProvider>
      </StrictMode>,
    ),
  );
