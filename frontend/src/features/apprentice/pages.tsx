import './apprentice.css';
import { Dashboard } from './skills/Dashboard';
import { SkillPage } from './skills/SkillPage';
import { LessonCourse } from './course/LessonCourse';
import { TrainingRoom } from './training/TrainingRoom';
import { TestPage } from './test/TestPage';
import { TutorialPage } from './tutorial/TutorialPage';
import { PlayPage } from './play/PlayPage';

/** Learner dashboard: the Today panel, a skill search and every skill as a card (live ones open to practise). */
export const ApprenticeHome = Dashboard;
/** One skill: a showcase of its first lessons, what it is, the next lesson to practise and the lesson list. */
export const ApprenticeSkill = SkillPage;
/** The course page: ordered syllabus with video slot, instructions and progress, ending with "Test your skills". */
export const ApprenticeLesson = LessonCourse;
/** The training room: master reference, live wooden hand, four guidance modes, coaching and scoring. */
export const ApprenticeStep = TrainingRoom;
/** "Test your skills": the premade table tennis rally or piano play-along for the lesson. */
export const ApprenticeTest = TestPage;
/** A step's Tutorial: the expert's video beside the chalk hand playing the reference take in sync, before practice. */
export const ApprenticeTutorial = TutorialPage;
/** Play, the end of a course: moves called one by one, scored live, or the course's own game when it has one. */
export const ApprenticePlay = PlayPage;
