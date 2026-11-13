import './apprentice.css';
import { Library } from './library/Library';
import { LessonCourse } from './course/LessonCourse';
import { TrainingRoom } from './training/TrainingRoom';
import { TestPage } from './test/TestPage';

/** Apprentice lesson library: skill, master, step count and reference status for every lesson. */
export const ApprenticeHome = Library;
/** The course page: ordered syllabus with video slot, instructions and progress, ending with "Test your skills". */
export const ApprenticeLesson = LessonCourse;
/** The training room: master reference, live wooden hand, four guidance modes, coaching and scoring. */
export const ApprenticeStep = TrainingRoom;
/** "Test your skills": the premade table tennis rally or piano play-along for the lesson. */
export const ApprenticeTest = TestPage;
