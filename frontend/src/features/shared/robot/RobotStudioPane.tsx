import type { GloveStreamHandle, Side } from '../../../api';
import { useRobotStream } from '../../../api/useRobotStream';
import { Disclosure } from '../../../components/ui';
import { RobotPanel, robotStateLine } from './RobotPanel';
import { useRobotPane } from './robotPrefs';
import { RobotTwin } from './RobotTwin';
import './robot.css';

interface RobotStudioPaneProps {
  glove: GloveStreamHandle;
  side: Side;
}

/** The expert studio's robot pane: the twin follows the expert's glove, folded under the live stage. */
export function RobotStudioPane({ glove, side }: RobotStudioPaneProps) {
  const [on] = useRobotPane();
  const robot = useRobotStream(on);
  if (!on) return null;
  const state = robotStateLine(robot);
  const mockApp = typeof window !== 'undefined' && window.__apprenticeMock === true;
  return (
    <Disclosure summary={`Robot hand: ${state.text}`} className="rb-studio" defaultOpen={robot.status === 'open'}>
      <div className="rb-studio__grid">
        <RobotTwin robot={robot} human={{ side: robot.hand ?? side, style: 'chalk', live: glove.latest, label: 'Your glove' }} decoupled={mockApp && !robot.mock} className="rb-twin--studio" />
        <RobotPanel robot={robot} compact />
      </div>
    </Disclosure>
  );
}
