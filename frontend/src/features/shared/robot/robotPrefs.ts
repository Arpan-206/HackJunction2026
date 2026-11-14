import { pref } from '../settings';

/**
 * Whether the training room and the expert studio show the robot twin beside the human hand. On by default: the robot
 * hand is the centre of the demo. Stored in localStorage as `apprentice.robotView` ('0' when off).
 */
export const robotPanePref = pref<boolean>('apprentice.robotView', (raw) => raw !== '0', (v) => (v ? null : '0'));
export const useRobotPane = robotPanePref.use;
