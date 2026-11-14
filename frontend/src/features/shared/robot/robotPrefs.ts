import { pref } from '../settings';

/**
 * Whether the training room and the expert studio show the robot twin beside the human hand. On by default: the robot
 * hand is the centre of the demo. Stored in localStorage as `apprentice.robotView` ('0' when off).
 */
export const robotPanePref = pref<boolean>('apprentice.robotView', (raw) => raw !== '0', (v) => (v ? null : '0'));
export const useRobotPane = robotPanePref.use;

/**
 * Which robot hand the twin draws. `dex3_1`: the Unitree Dex3-1, three fingers, driven by the engine's joint targets on
 * /ws/robot. `humanoid`: a five-finger humanoid hand, the app's own hand mesh in steel, which copies every human joint,
 * so it needs no retargeting and works with no engine at all. Stored in localStorage as `apprentice.robotModel`.
 */
export type RobotModelChoice = 'dex3_1' | 'humanoid';
export const ROBOT_MODEL_OPTIONS: { id: RobotModelChoice; label: string; hint: string }[] = [
  { id: 'dex3_1', label: 'Three fingers', hint: 'Unitree Dex3-1: thumb, index and middle, seven joints, driven by the glove engine.' },
  { id: 'humanoid', label: 'Five fingers', hint: 'A humanoid robot hand that copies every joint of every finger.' },
];
export const robotModelPref = pref<RobotModelChoice>('apprentice.robotModel', (raw) => (raw === 'humanoid' ? 'humanoid' : 'dex3_1'), (v) => (v === 'dex3_1' ? null : v));
export const useRobotModelChoice = robotModelPref.use;
