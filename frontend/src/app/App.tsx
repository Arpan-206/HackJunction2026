import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './AppShell';
import { RoleSelect } from './RoleSelect';
import { lazyPage, whenIdle } from './lazyPage';
import './pageStyles';
import { isKiosk, KIOSK_HOME } from '../features/shared/kiosk';
import { ensureNoGloves } from '../features/shared/noGloves';

// The expert and apprentice pages and the hand lab load on demand, then in the background once the first screen is up.
const masterPages = () => import('../features/master/pages');
const apprenticePages = () => import('../features/apprentice/pages');
const HandLab = lazyPage(() => import('./HandLab').then((m) => m.HandLab));
const MasterHome = lazyPage(() => import('../features/master/MasterHome').then((m) => m.MasterHome));
const MasterScratch = lazyPage(() => masterPages().then((m) => m.MasterScratch));
const MasterGenerate = lazyPage(() => masterPages().then((m) => m.MasterGenerate));
const MasterSkill = lazyPage(() => masterPages().then((m) => m.MasterSkill));
const MasterLesson = lazyPage(() => masterPages().then((m) => m.MasterLesson));
const ApprenticeHome = lazyPage(() => apprenticePages().then((m) => m.ApprenticeHome));
const ApprenticeSkill = lazyPage(() => apprenticePages().then((m) => m.ApprenticeSkill));
const ApprenticeLesson = lazyPage(() => apprenticePages().then((m) => m.ApprenticeLesson));
const ApprenticeStep = lazyPage(() => apprenticePages().then((m) => m.ApprenticeStep));
const ApprenticeTest = lazyPage(() => apprenticePages().then((m) => m.ApprenticeTest));
const ApprenticeTutorial = lazyPage(() => apprenticePages().then((m) => m.ApprenticeTutorial));
const ApprenticePlay = lazyPage(() => apprenticePages().then((m) => m.ApprenticePlay));
const PAGES = [MasterHome, ApprenticeHome, MasterScratch, MasterGenerate, MasterSkill, MasterLesson, ApprenticeSkill, ApprenticeLesson, ApprenticeStep, ApprenticeTest, ApprenticeTutorial, ApprenticePlay, HandLab];

const Playground = lazy(() => import('../playground/Playground'));
const DesignRoute = lazy(() => import('../design/DesignRoute'));
const GlovesScreen = lazy(() => import('../features/shared/gloves/GlovesScreen'));
const CalibrateScreen = lazy(() => import('../features/shared/gloves/CalibrateScreen'));
const RobotScreen = lazy(() => import('../features/shared/robot/RobotScreen'));
const HandCameraView = lazy(() => import('../dev/HandCameraView'));
const GloveCompare = lazy(() => import('../dev/GloveCompare'));
const TypingScreen = lazy(() => import('../features/typing/TypingScreen'));
const FingerspellingScreen = lazy(() => import('../features/fingerspelling/FingerspellingScreen'));
const DemoScreen = lazy(() => import('../features/apprentice/demo/DemoScreen'));

/** Old /master/* links (bookmarks, earlier demos) land on the same /expert/* page, keeping the subpath, query and hash. */
function MasterRedirect() {
  const { pathname, search, hash } = useLocation();
  return <Navigate replace to={`/expert${pathname.replace(/^\/master/, '')}${search}${hash}`} />;
}

/** Route table. Feature agents replace the page components, not the paths. */
export function App() {
  // Read once per load. The flag sticks for the tab; only ?kiosk=0 (the operator) turns it off, and a VITE_KIOSK build never.
  const [kiosk] = useState(isKiosk);
  // "No gloves" survives a backend restart: put the backend back on the simulator once per load.
  useEffect(ensureNoGloves, []);
  // Fetch the pages while the first screen idles, so following a link never waits for code. The kiosk only shows the demo.
  useEffect(() => (kiosk ? undefined : whenIdle(() => PAGES.forEach((p) => void p.preload().catch(() => undefined)))), [kiosk]);
  if (kiosk) {
    return (
      <Routes>
        <Route path={KIOSK_HOME} element={<Suspense fallback={null}><DemoScreen kiosk /></Suspense>} />
        <Route path="*" element={<Navigate replace to={KIOSK_HOME} />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/" element={<RoleSelect />} />
      <Route path="/demo" element={<Suspense fallback={null}><DemoScreen /></Suspense>} />
      <Route path="/playground" element={<Suspense fallback={null}><Playground /></Suspense>} />
      <Route path="/design" element={<Suspense fallback={null}><DesignRoute /></Suspense>} />
      <Route path="/design/:frame" element={<Suspense fallback={null}><DesignRoute /></Suspense>} />
      <Route path="/dev/hand-camera" element={<Suspense fallback={null}><HandCameraView /></Suspense>} />
      <Route path="/dev/glove-compare" element={<Suspense fallback={null}><GloveCompare /></Suspense>} />
      <Route element={<AppShell />}>
        <Route path="/expert" element={<MasterHome />} />
        <Route path="/expert/scratch" element={<MasterScratch />} />
        <Route path="/expert/generate" element={<MasterGenerate />} />
        <Route path="/expert/skills/:skillKey" element={<MasterSkill />} />
        <Route path="/expert/lessons/:lessonId" element={<MasterLesson />} />
        <Route path="/master/*" element={<MasterRedirect />} />
        <Route path="/apprentice" element={<ApprenticeHome />} />
        <Route path="/apprentice/skills/:skillId" element={<ApprenticeSkill />} />
        <Route path="/apprentice/fingerspelling" element={<Suspense fallback={null}><FingerspellingScreen /></Suspense>} />
        {/* The old lesson list lived at /apprentice; bare list paths land on the dashboard rather than a dead page. */}
        <Route path="/apprentice/skills" element={<Navigate replace to="/apprentice" />} />
        <Route path="/apprentice/lessons" element={<Navigate replace to="/apprentice" />} />
        <Route path="/apprentice/library" element={<Navigate replace to="/apprentice" />} />
        <Route path="/apprentice/lessons/:lessonId" element={<ApprenticeLesson />} />
        <Route path="/apprentice/lessons/:lessonId/steps/:stepIndex" element={<ApprenticeStep />} />
        <Route path="/apprentice/lessons/:lessonId/test" element={<ApprenticeTest />} />
        <Route path="/apprentice/lessons/:lessonId/steps/:stepIndex/tutorial" element={<ApprenticeTutorial />} />
        <Route path="/apprentice/lessons/:lessonId/play" element={<ApprenticePlay />} />
        <Route path="/lab" element={<HandLab />} />
        <Route path="/gloves" element={<Suspense fallback={null}><GlovesScreen /></Suspense>} />
        <Route path="/gloves/calibrate" element={<Suspense fallback={null}><CalibrateScreen /></Suspense>} />
        <Route path="/robot" element={<Suspense fallback={null}><RobotScreen /></Suspense>} />
        <Route path="/typing" element={<Suspense fallback={null}><TypingScreen /></Suspense>} />
        <Route path="*" element={<MasterHome />} />
      </Route>
    </Routes>
  );
}
