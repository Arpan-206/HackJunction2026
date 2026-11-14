import { lazy, Suspense, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './AppShell';
import { RoleSelect } from './RoleSelect';
import { HandLab } from './HandLab';
import { MasterHome } from '../features/master/MasterHome';
import { MasterGenerate, MasterLesson, MasterScratch, MasterSkill } from '../features/master/pages';
import { ApprenticeHome, ApprenticeLesson, ApprenticePlay, ApprenticeSkill, ApprenticeStep, ApprenticeTest, ApprenticeTutorial } from '../features/apprentice/pages';
import { isKiosk, KIOSK_HOME } from '../features/shared/kiosk';

const Playground = lazy(() => import('../playground/Playground'));
const DesignRoute = lazy(() => import('../design/DesignRoute'));
const GlovesScreen = lazy(() => import('../features/shared/gloves/GlovesScreen'));
const CalibrateScreen = lazy(() => import('../features/shared/gloves/CalibrateScreen'));
const RobotScreen = lazy(() => import('../features/shared/robot/RobotScreen'));
const HandCameraView = lazy(() => import('../dev/HandCameraView'));
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
