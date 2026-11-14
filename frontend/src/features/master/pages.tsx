import './master.css';
import { GenerateSteps } from './generate/GenerateSteps';
import { SkillPage } from './home/SkillPage';
import { LessonStudio } from './lesson/LessonStudio';
import { ScratchStudio } from './scratch/ScratchStudio';

/** /master/scratch: record moves by hand against a live 3D hand and save them as a lesson. */
export const MasterScratch = () => <ScratchStudio />;
/** /master/generate: describe a lesson, review the drafted steps, record real takes. */
export const MasterGenerate = () => <GenerateSteps />;
/** /master/lessons/:lessonId: lesson overview and editor. */
export const MasterLesson = () => <LessonStudio />;
/** /expert/skills/:skillKey: one skill's lessons. */
export const MasterSkill = () => <SkillPage />;
