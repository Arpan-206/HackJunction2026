import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './AppShell';
import { RoleSelect } from './RoleSelect';
import { HandLab } from './HandLab';
import { MasterHome } from '../features/master/MasterHome';
import { MasterGenerate, MasterLesson, MasterScratch } from '../features/master/pages';
import { ApprenticeHome, ApprenticeLesson, ApprenticeSkill, ApprenticeStep, ApprenticeTest } from '../features/apprentice/pages';

const Playground = lazy(() => import('../playground/Playground'));
const DesignRoute = lazy(() => import('../design/DesignRoute'));

/** Old /master/* links (bookmarks, earlier demos) land on the same /expert/* page, keeping the subpath, query and hash. */
function MasterRedirect() {
  const { pathname, search, hash } = useLocation();
  return <Navigate replace to={`/expert${pathname.replace(/^\/master/, '')}${search}${hash}`} />;
}

/** Route table. Feature agents replace the page components, not the paths. */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<RoleSelect />} />
      <Route path="/playground" element={<Suspense fallback={null}><Playground /></Suspense>} />
      <Route path="/design" element={<Suspense fallback={null}><DesignRoute /></Suspense>} />
      <Route path="/design/:frame" element={<Suspense fallback={null}><DesignRoute /></Suspense>} />
      <Route element={<AppShell />}>
        <Route path="/expert" element={<MasterHome />} />
        <Route path="/expert/scratch" element={<MasterScratch />} />
        <Route path="/expert/generate" element={<MasterGenerate />} />
        <Route path="/expert/lessons/:lessonId" element={<MasterLesson />} />
        <Route path="/master/*" element={<MasterRedirect />} />
        <Route path="/apprentice" element={<ApprenticeHome />} />
        <Route path="/apprentice/skills/:skillId" element={<ApprenticeSkill />} />
        {/* The old lesson list lived at /apprentice; bare list paths land on the dashboard rather than a dead page. */}
        <Route path="/apprentice/skills" element={<Navigate replace to="/apprentice" />} />
        <Route path="/apprentice/lessons" element={<Navigate replace to="/apprentice" />} />
        <Route path="/apprentice/library" element={<Navigate replace to="/apprentice" />} />
        <Route path="/apprentice/lessons/:lessonId" element={<ApprenticeLesson />} />
        <Route path="/apprentice/lessons/:lessonId/steps/:stepIndex" element={<ApprenticeStep />} />
        <Route path="/apprentice/lessons/:lessonId/test" element={<ApprenticeTest />} />
        <Route path="/lab" element={<HandLab />} />
        <Route path="*" element={<MasterHome />} />
      </Route>
    </Routes>
  );
}
