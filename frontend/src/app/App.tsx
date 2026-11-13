import { Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { RoleSelect } from './RoleSelect';
import { HandLab } from './HandLab';
import { MasterHome } from '../features/master/MasterHome';
import { MasterGenerate, MasterLesson, MasterScratch } from '../features/master/pages';
import { ApprenticeHome, ApprenticeLesson, ApprenticeStep, ApprenticeTest } from '../features/apprentice/pages';

/** Route table. Feature agents replace the page components, not the paths. */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<RoleSelect />} />
      <Route element={<AppShell />}>
        <Route path="/master" element={<MasterHome />} />
        <Route path="/master/scratch" element={<MasterScratch />} />
        <Route path="/master/generate" element={<MasterGenerate />} />
        <Route path="/master/lessons/:lessonId" element={<MasterLesson />} />
        <Route path="/apprentice" element={<ApprenticeHome />} />
        <Route path="/apprentice/lessons/:lessonId" element={<ApprenticeLesson />} />
        <Route path="/apprentice/lessons/:lessonId/steps/:stepIndex" element={<ApprenticeStep />} />
        <Route path="/apprentice/lessons/:lessonId/test" element={<ApprenticeTest />} />
        <Route path="/lab" element={<HandLab />} />
        <Route path="*" element={<MasterHome />} />
      </Route>
    </Routes>
  );
}
